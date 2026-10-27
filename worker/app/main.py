"""AlphaTerminal Worker v1.1: one-process FastAPI + SQLite + per-device Web Push."""
import asyncio
import hashlib
import base64
import hmac
import json
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Any
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from .db import init,read_db,transaction,profile_state,apply_changes,new_id,compact,Conflict,now
from .security import authorize,check_bootstrap,issue_device,digest,issue_recovery,read_recovery,verify_recovery
from .market import check_market,RULES
from .news import check_news
from .holding_news import holdings_news

log=logging.getLogger('alphaterminal')
ALLOWED_ORIGIN=os.getenv('AT_CORS_ORIGIN','https://sicho95.github.io').rstrip('/')
PAIR_TTL=300
ATTEMPTS={}

def ratelimit(request, family, n=20, window=60):
    ip=request.client.host if request.client else 'unknown'
    key=(ip,family)
    epoch=time.monotonic()
    count,first=ATTEMPTS.get(key,(0,epoch))
    if epoch-first>window:count,first=0,epoch
    if count>=n:raise HTTPException(429,'Trop de tentatives')
    ATTEMPTS[key]=(count+1,first)

def validate_json(value, limit=1200000):
    if len(compact(value).encode())>limit:raise HTTPException(413,'Données trop volumineuses')
    if not isinstance(value,dict):raise HTTPException(422,'Objet JSON attendu')
    return value

class First(BaseModel):
    code:str
    profile_name:str=Field(min_length=1,max_length=80)
    device_name:str=Field(min_length=1,max_length=80)

class PublicProfile(BaseModel):
    profile_name:str=Field(min_length=1,max_length=80)
    device_name:str=Field(min_length=1,max_length=80)

class RecoverProfile(BaseModel):
    profile_id:str=Field(min_length=5,max_length=100)
    recovery_secret:str=Field(min_length=40,max_length=160)
    device_name:str=Field(min_length=1,max_length=80)

class AdminStatus(BaseModel):
    disabled:bool

class AdminRemove(BaseModel):
    confirm_name:str

class InviteClaim(BaseModel):
    code:str=Field(pattern=r'^\d{6}$')
    device_name:str=Field(min_length=1,max_length=80)

class PairStart(BaseModel):
    device_name:str=Field(min_length=1,max_length=80)

class PairApprove(BaseModel):
    code:str=Field(min_length=6,max_length=6)

class PairClaim(BaseModel):
    request_id:str
    claim_secret:str

class Changes(BaseModel):
    settings_patch:dict[str,Any]|None=None
    settings_base_rev:int|None=None
    data:dict[str,Any]|None=None
    data_base_rev:int|None=None

class PushInput(BaseModel):
    subscription:dict[str,Any]

@asynccontextmanager
async def lifespan(app):
    init()
    task=asyncio.create_task(scheduler())
    try:yield
    finally:
        task.cancel()
        try:await task
        except asyncio.CancelledError:pass

app=FastAPI(title='AlphaTerminal Worker',version='1.2.1',lifespan=lifespan,docs_url=None,redoc_url=None)
app.add_middleware(CORSMiddleware,allow_origins=[ALLOWED_ORIGIN],allow_methods=['GET','POST','DELETE'],
                   allow_headers=['authorization','content-type'],allow_credentials=False)

@app.get('/health')
def health():return {'status':'ok','service':'alphaterminal-worker'}

# Inscription autonome: aucun secret administrateur requis, quotas cote serveur
# et consommation bornee par profil. Les profils historiques restent inchanges.
@app.post('/api/v1/profiles/create')
def public_create(body:PublicProfile,request:Request):
    ratelimit(request,'public-create',n=3,window=3600)
    ip=request.client.host if request.client else 'unknown'
    ip_hash=hashlib.sha256(ip.encode()).hexdigest()
    since=(datetime.now(timezone.utc)-timedelta(days=1)).isoformat()
    max_profiles=max(1,int(os.getenv('AT_MAX_PROFILES','60')))
    max_signups=max(1,int(os.getenv('AT_SIGNUPS_PER_DAY','20')))
    per_ip=max(1,int(os.getenv('AT_SIGNUPS_PER_IP_DAY','5')))
    with transaction() as db:
        count=db.execute('SELECT COUNT(*) FROM profiles').fetchone()[0]
        day_count=db.execute('SELECT COUNT(*) FROM profile_signups WHERE created_at>=?',(since,)).fetchone()[0]
        local_count=db.execute('SELECT COUNT(*) FROM profile_signups WHERE created_at>=? AND ip_hash=?',(since,ip_hash)).fetchone()[0]
        if count>=max_profiles or day_count>=max_signups or local_count>=per_ip:
            raise HTTPException(429,'Capacite des inscriptions atteinte. Reessayer plus tard.')
        pid=new_id('profile')
        db.execute('INSERT INTO profiles(id,name,created_at) VALUES(?,?,?)',(pid,body.profile_name.strip(),now()))
        secret=issue_recovery(db,pid)
        credentials=issue_device(db,pid,body.device_name.strip())
        db.execute('INSERT INTO profile_signups(id,ip_hash,created_at) VALUES(?,?,?)',(pid,ip_hash,now()))
        return {**credentials,'profile_name':body.profile_name.strip(),'recovery_secret':secret}

@app.get('/api/v1/profiles/recovery')
def get_profile_recovery(authorization:str|None=Header(None)):
    with transaction() as db:
        device=authorize(db,authorization)
        return {'profile_id':device['profile_id'],'recovery_secret':read_recovery(db,device['profile_id'])}

@app.post('/api/v1/profiles/recover')
def recover_profile(body:RecoverProfile,request:Request):
    ratelimit(request,'public-recover',n=12,window=120)
    with transaction() as db:
        verify_recovery(db,body.profile_id,body.recovery_secret)
        creds=issue_device(db,body.profile_id,body.device_name.strip())
        name=db.execute('SELECT name FROM profiles WHERE id=?',(body.profile_id,)).fetchone()['name']
        return {**creds,'profile_name':name}

def verify_admin(request:Request,admin_key:str|None):
    ratelimit(request,'admin',n=12,window=300)
    configured=os.getenv('AT_BOOTSTRAP_CODE','')
    if not admin_key or len(configured)<24 or not hmac.compare_digest(configured,admin_key):
        raise HTTPException(403,'Acces administrateur refuse')

@app.get('/admin',include_in_schema=False)
def admin_page():
    return FileResponse(Path(__file__).parent/'admin.html',media_type='text/html',
                        headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
                        'X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
                        'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"})

@app.get('/api/v1/admin/profiles')
def admin_profiles(request:Request,x_admin_key:str|None=Header(None)):
    verify_admin(request,x_admin_key)
    with read_db() as db:
        rows=db.execute('''SELECT p.id,p.name,p.created_at,p.disabled,
            (SELECT COUNT(*) FROM devices d WHERE d.profile_id=p.id AND d.revoked=0) AS active_devices
            FROM profiles p ORDER BY p.created_at DESC LIMIT 250''').fetchall()
        return {'profiles':[dict(r) for r in rows]}

@app.post('/api/v1/admin/profiles/{profile_id}/status')
def admin_status(profile_id:str,body:AdminStatus,request:Request,x_admin_key:str|None=Header(None)):
    verify_admin(request,x_admin_key)
    with transaction() as db:
        updated=db.execute('UPDATE profiles SET disabled=? WHERE id=?',(int(body.disabled),profile_id))
        if not updated.rowcount:raise HTTPException(404,'Profil inconnu')
    return {'profile_id':profile_id,'disabled':body.disabled}

@app.delete('/api/v1/admin/profiles/{profile_id}')
def admin_delete(profile_id:str,body:AdminRemove,request:Request,x_admin_key:str|None=Header(None)):
    verify_admin(request,x_admin_key)
    with transaction() as db:
        profile=db.execute('SELECT name FROM profiles WHERE id=?',(profile_id,)).fetchone()
        if not profile:raise HTTPException(404,'Profil inconnu')
        if body.confirm_name!=profile['name']:raise HTTPException(409,'Confirmer exactement le nom du profil')
        for table in ('seen_news','alert_states','alerts','setting_edits','pairs','pair_invites','market_quotes','holding_news_cache','devices'):
            db.execute(f'DELETE FROM {table} WHERE profile_id=?',(profile_id,))
        db.execute('DELETE FROM profiles WHERE id=?',(profile_id,))
    return {'deleted':profile_id}

@app.post('/api/v1/setup/first')
def first(body:First, request:Request):
    ratelimit(request,'bootstrap',n=6,window=180)
    check_bootstrap(body.code)
    with transaction() as db:
        if db.execute('SELECT COUNT(*) FROM profiles').fetchone()[0]:
            raise HTTPException(409,'Initialisation déjà effectuée')
        pid=new_id('profile')
        db.execute('INSERT INTO profiles(id,name,created_at) VALUES(?,?,?)',(pid,body.profile_name,now()))
        creds=issue_device(db,pid,body.device_name)
        return {**creds,'profile_name':body.profile_name}

@app.post('/api/v1/setup/add-profile')
def add_profile(body:First, request:Request):
    ratelimit(request,'addprofile',n=6,window=180)
    check_bootstrap(body.code)
    with transaction() as db:
        pid=new_id('profile')
        db.execute('INSERT INTO profiles(id,name,created_at) VALUES(?,?,?)',(pid,body.profile_name,now()))
        return {**issue_device(db,pid,body.device_name),'profile_name':body.profile_name}

@app.post('/api/v1/pair/invite')
def create_pair_invite(request:Request,authorization:str|None=Header(None)):
    """The OLD authorized device displays the code; NEW device types it."""
    ratelimit(request,'pair-invite',n=8,window=300)
    with transaction() as db:
        dev=authorize(db,authorization)
        db.execute('DELETE FROM pair_invites WHERE expires_at<?',(time.time(),))
        db.execute('DELETE FROM pair_invites WHERE profile_id=?',(dev['profile_id'],))
        for _ in range(10):
            code=f'{secrets.randbelow(1000000):06d}'
            if not db.execute('SELECT 1 FROM pair_invites WHERE code_hash=?',(digest(code),)).fetchone():
                break
        else:raise HTTPException(503,'Aucun code disponible')
        db.execute('INSERT INTO pair_invites(id,profile_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)',
                   (new_id('invite'),dev['profile_id'],digest(code),time.time()+PAIR_TTL,now()))
        return {'code':code,'expires_in':PAIR_TTL}

@app.post('/api/v1/pair/join')
def join_pair_invite(body:InviteClaim,request:Request):
    ratelimit(request,'pair-join',n=8,window=300)
    with transaction() as db:
        row=db.execute('SELECT * FROM pair_invites WHERE code_hash=? AND used=0 AND expires_at>?',
                       (digest(body.code),time.time())).fetchone()
        if not row:raise HTTPException(404,'Code incorrect, déjà utilisé ou expiré')
        profile=db.execute('SELECT name,disabled FROM profiles WHERE id=?',(row['profile_id'],)).fetchone()
        if not profile or profile['disabled']:raise HTTPException(403,'Profil indisponible')
        db.execute('UPDATE pair_invites SET used=1 WHERE id=?',(row['id'],))
        return {**issue_device(db,row['profile_id'],body.device_name.strip()),
                'profile_name':profile['name']}

@app.post('/api/v1/pair/start')
def start_pair(body:PairStart,request:Request):
    ratelimit(request,'pairstart',n=6,window=60)
    req=new_id('pair'); code=f'{secrets.randbelow(1000000):06d}'; secret=secrets.token_urlsafe(32)
    with transaction() as db:
        db.execute('DELETE FROM pairs WHERE expires_at<?',(time.time(),))
        db.execute('INSERT INTO pairs(id,code_hash,claim_hash,device_name,expires_at) VALUES(?,?,?,?,?)',
                   (req,digest(code),digest(secret),body.device_name,time.time()+PAIR_TTL))
    return {'request_id':req,'code':code,'claim_secret':secret,'expires_in':PAIR_TTL}

@app.post('/api/v1/pair/approve')
def approve_pair(body:PairApprove,request:Request,authorization:str|None=Header(None)):
    ratelimit(request,'pairapprove',n=12,window=60)
    with transaction() as db:
        device=authorize(db,authorization)
        # Compare constant time across bounded active requests.
        rows=db.execute('SELECT * FROM pairs WHERE expires_at>? AND profile_id IS NULL',(time.time(),)).fetchall()
        row=next((r for r in rows if hmac.compare_digest(r['code_hash'],digest(body.code))),None)
        if row is None:raise HTTPException(404,'Code expiré ou incorrect')
        creds=issue_device(db,device['profile_id'],row['device_name'])
        db.execute('UPDATE pairs SET profile_id=?,issued_token=?,issued_device=? WHERE id=?',
                   (device['profile_id'],creds['token'],creds['device_id'],row['id']))
        return {'paired_device':row['device_name'],'device_id':creds['device_id']}

@app.post('/api/v1/pair/claim')
def claim_pair(body:PairClaim,request:Request):
    ratelimit(request,'pairclaim',n=30,window=60)
    with transaction() as db:
        row=db.execute('SELECT * FROM pairs WHERE id=? AND expires_at>?',(body.request_id,time.time())).fetchone()
        if row is None or not hmac.compare_digest(row['claim_hash'],digest(body.claim_secret)):
            raise HTTPException(404,'Appairage expiré')
        if row['claimed']:raise HTTPException(410,'Jeton déjà récupéré')
        if not row['issued_token']:
            return {'status':'pending'}
        db.execute('UPDATE pairs SET claimed=1,issued_token=NULL WHERE id=?',(row['id'],))
        return {'status':'ready','profile_id':row['profile_id'],'device_id':row['issued_device'],'token':row['issued_token']}

@app.get('/api/v1/sync/state')
def sync_state(authorization:str|None=Header(None)):
    with read_db() as db:
        device=authorize(db,authorization)
        return profile_state(db,device['profile_id'])

@app.post('/api/v1/sync/changes')
def sync_changes(body:Changes, authorization:str|None=Header(None)):
    payload=body.model_dump(exclude_none=True)
    if not payload or (not payload.get('settings_patch') and 'data' not in payload):
        raise HTTPException(422,'Changement requis')
    if payload.get('settings_patch') is not None:
        validate_json(payload['settings_patch'],100000)
        if 'autoRefreshMinutes' in payload['settings_patch']:
            try:
                value=int(float(payload['settings_patch']['autoRefreshMinutes']))
                if value < 5 or value > 120:
                    raise ValueError('outside limits')
            except (TypeError,ValueError,OverflowError):
                raise HTTPException(422,'Actualisation autorisée : de 5 à 120 minutes')
        banned={'marketauxApiKey','finnhubApiKey','twelveDataApiKey','token','deviceToken','workerToken','workerUrl'}
        if any(k in banned or k.startswith('_') for k in payload['settings_patch']):
            raise HTTPException(422,'Clé de configuration interdite')
    if 'data' in payload:
        validate_json(payload['data'])
    with transaction() as db:
        device=authorize(db,authorization)
        try:return profile_state(db,device['profile_id']) if not payload else apply_changes(db,device['profile_id'],payload)
        except Conflict as e:raise HTTPException(409,{'type':e.kind,'keys':e.keys})
        except ValueError as e:raise HTTPException(422,str(e))

@app.get('/api/v1/alerts')
def alerts(after:str='',authorization:str|None=Header(None)):
    with read_db() as db:
        device=authorize(db,authorization)
        rows=db.execute('SELECT payload_json FROM alerts WHERE profile_id=? AND created_at>? ORDER BY created_at DESC LIMIT 100',
                        (device['profile_id'],after)).fetchall()
        return {'alerts':[json.loads(row['payload_json']) for row in rows]}

@app.get('/api/v1/devices')
def devices(authorization:str|None=Header(None)):
    with read_db() as db:
        device=authorize(db,authorization)
        rows=db.execute('SELECT id,name,created_at,push_json IS NOT NULL AS push_enabled FROM devices WHERE profile_id=? AND revoked=0',
                        (device['profile_id'],)).fetchall()
        return {'devices':[dict(r) for r in rows],'current_device_id':device['id']}

@app.post('/api/v1/devices/{device_id}/revoke')
def revoke_device(device_id:str,authorization:str|None=Header(None)):
    with transaction() as db:
        device=authorize(db,authorization)
        if device['id']==device_id:raise HTTPException(409,'Révoquer cet appareil depuis un autre appareil')
        cur=db.execute('UPDATE devices SET revoked=1,push_json=NULL WHERE id=? AND profile_id=?',(device_id,device['profile_id']))
        if not cur.rowcount:raise HTTPException(404,'Appareil inconnu')
        return {'revoked':device_id}

def vapid_keys():
    data_dir=Path(os.getenv('AT_DATA_DIR','/tmp/alphaterminal-data'))
    pem=data_dir/'vapid_private.pem'
    if not pem.exists():
        key=ec.generate_private_key(ec.SECP256R1())
        pem.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        pem.chmod(0o600)
    else:
        key=serialization.load_pem_private_key(pem.read_bytes(),password=None)
    raw=key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
    return str(pem),base64.urlsafe_b64encode(raw).decode().rstrip('=')

@app.get('/api/v1/holdings/news')
async def holdings_specific_news(request:Request,days:int=7,position_id:str='',offset:int=0,
                                 authorization:str|None=Header(None)):
    """Only securities actually owned by the caller, never a macro/geopolitical feed."""
    if days not in (7,30) or len(position_id)>150 or not 0<=offset<=500:
        raise HTTPException(422,'Période 7/30 jours et pagination valides requises')
    with read_db() as db:
        device=authorize(db,authorization)
    ratelimit(request,'holding-news-'+device['profile_id'],n=25,window=60)
    return await holdings_news(device['profile_id'],days,position_id,offset)

@app.get('/api/v1/monitor/state')
def monitor_state(authorization:str|None=Header(None)):
    """Authenticated, read-only API: NAS is authoritative for quotes/news/alerts."""
    with read_db() as db:
        device=authorize(db,authorization)
        pid=device['profile_id']
        rows=db.execute('''SELECT position_key,symbol,price,as_of,closes_json,highs_json,lows_json,atr14,atr_multiplier,suggested_stop,updated_at
                           FROM market_quotes WHERE profile_id=? ORDER BY updated_at DESC LIMIT 300''',(pid,)).fetchall()
        settings=db.execute('SELECT settings_json FROM profiles WHERE id=?',(pid,)).fetchone()
        config=json.loads(settings['settings_json'])
        selected=config.get('macroProvider','multi')
        if selected not in {'multi','yahoo','oksurf','rss','gdelt'}:selected='multi'
        if selected=='multi':
            news_rows=db.execute('''SELECT title,url,source,provider,summary,updated_at
                                    FROM news_feed ORDER BY updated_at DESC LIMIT 100''').fetchall()
        else:
            news_rows=db.execute('''SELECT title,url,source,provider,summary,updated_at
                                    FROM news_feed WHERE provider=? ORDER BY updated_at DESC LIMIT 100''',
                                 (selected,)).fetchall()
        alerts=db.execute('''SELECT payload_json FROM alerts WHERE profile_id=?
                             ORDER BY created_at DESC LIMIT 100''',(pid,)).fetchall()
        return {
            'mode':'nas','contract_version':RULES['contract_version'],'rule_version':RULES['rule_version'],
            'sources':{'quotes':['Yahoo Finance'],'news':['OKSURF','Yahoo Finance','RSS AMF/BCE/Café de la Bourse','GDELT']},
            'quotes':[{**dict(row),'closes':json.loads(row['closes_json']),
                       'highs':json.loads(row['highs_json']),
                       'lows':json.loads(row['lows_json'])} for row in rows],
            'news':[dict(row) for row in news_rows],
            'alerts':[json.loads(row['payload_json']) for row in alerts],
            'limits':{'quotes_min_minutes':RULES['quotes_min_minutes'],'news_min_minutes':RULES['news_min_minutes']},
            'requested_refresh_minutes':config.get('autoRefreshMinutes',10),
            'dynamic_enabled':bool(config.get('dynamicEnabled',False))
        }

@app.get('/api/v1/push/key')
def push_public_key(authorization:str|None=Header(None)):
    with read_db() as db:authorize(db,authorization)
    return {'publicKey':vapid_keys()[1]}

def _push_endpoint_valid(endpoint):
    from urllib.parse import urlparse
    if not isinstance(endpoint,str) or not endpoint.startswith('https://') or len(endpoint)>3000:
        return False
    parsed=urlparse(endpoint)
    host=parsed.hostname or ''
    return (host in {'web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com',
                     'push.services.mozilla.com'} or host.endswith('.push.apple.com')) and parsed.port in (None,443)

@app.get('/api/v1/push/status')
def push_status(authorization:str|None=Header(None)):
    with read_db() as db:
        device=authorize(db,authorization)
        row=db.execute('''SELECT push_json,push_last_attempt,push_last_success,push_last_error
                          FROM devices WHERE id=?''',(device['id'],)).fetchone()
        settings=db.execute('SELECT settings_json FROM profiles WHERE id=?',(device['profile_id'],)).fetchone()
        config=json.loads(settings['settings_json'])
        enabled=config.get('dynamicEnabled',False)
        try:minutes=max(RULES['quotes_min_minutes'],min(RULES['quotes_max_minutes'],int(float(config.get('autoRefreshMinutes',10)))))
        except (TypeError,ValueError,OverflowError):minutes=10
        return {
            'subscribed':bool(row['push_json']),
            'dynamic_enabled':bool(enabled),
            'worker_subject_configured':os.getenv('AT_VAPID_SUBJECT','').startswith(('mailto:','https://')),
            'last_attempt':row['push_last_attempt'],
            'last_success':row['push_last_success'],
            'last_error':row['push_last_error'],
            'quotes_interval_seconds':minutes*60,
            'news_interval_seconds':max(RULES['news_min_minutes'],minutes)*60
        }

@app.post('/api/v1/push/subscribe')
def push_subscribe(body:PushInput,authorization:str|None=Header(None)):
    sub=validate_json(body.subscription,20000)
    if not _push_endpoint_valid(sub.get('endpoint','')):
        raise HTTPException(422,'Service Web Push non reconnu')
    if not isinstance(sub.get('keys'),dict) or not all(sub['keys'].get(k) for k in ('p256dh','auth')):
        raise HTTPException(422,'Clés Push manquantes')
    with transaction() as db:
        device=authorize(db,authorization)
        db.execute('''UPDATE devices SET push_json=?,push_last_error=NULL WHERE id=?''',
                   (compact(sub),device['id']))
    return {'enabled':True}

async def _send_push(row,event):
    subject=os.getenv('AT_VAPID_SUBJECT','')
    if not subject.startswith(('mailto:','https://')):
        return {'sent':False,'reason':'AT_VAPID_SUBJECT absent'}
    try:
        from pywebpush import webpush
    except ImportError:
        return {'sent':False,'reason':'pywebpush absent'}
    try:
        pem,_=vapid_keys()
        await asyncio.to_thread(webpush,
            subscription_info=json.loads(row['push_json']),data=compact(event),
            vapid_private_key=pem,vapid_claims={'sub':subject},ttl=600)
        with transaction() as db:
            db.execute('''UPDATE devices SET push_last_attempt=?,push_last_success=?,push_last_error=NULL
                          WHERE id=?''',(now(),now(),row['id']))
        return {'sent':True}
    except Exception as e:
        status=getattr(getattr(e,'response',None),'status_code',None)
        detail=f'{type(e).__name__}'+(f' HTTP {status}' if status else '')
        log.warning('Web Push NAS failed device=%s reason=%s',row['id'],detail)
        with transaction() as db:
            db.execute('''UPDATE devices SET push_last_attempt=?,push_last_error=? WHERE id=?''',
                       (now(),detail,row['id']))
            if status in (404,410):db.execute('UPDATE devices SET push_json=NULL WHERE id=?',(row['id'],))
        return {'sent':False,'reason':detail}

BACKGROUND_PUSH_TESTS=set()

@app.post('/api/v1/push/test')
async def push_test(request:Request,authorization:str|None=Header(None)):
    """Schedules a 15s worker-generated Web Push to test iOS with app closed."""
    ratelimit(request,'push-test',n=4,window=300)
    with read_db() as db:
        device=authorize(db,authorization)
        row=db.execute('SELECT id,push_json FROM devices WHERE id=?',(device['id'],)).fetchone()
    if not row['push_json']:raise HTTPException(409,'Cet appareil n’est pas abonné aux Web Push')
    event={'id':new_id('push-test'),'title':'AlphaTerminal · test NAS',
           'message':'Cette notification est envoyée par le worker NAS, même si la PWA est fermée.',
           'type':'push-test','severity':'info','timestamp':now()}
    async def later():
        await asyncio.sleep(15)
        await _send_push(row,event)
    task=asyncio.create_task(later())
    BACKGROUND_PUSH_TESTS.add(task)
    task.add_done_callback(BACKGROUND_PUSH_TESTS.discard)
    return {'scheduled':True,'delay_seconds':15}


async def dispatch(profile_id,event):
    with read_db() as db:
        rows=db.execute('''SELECT id,push_json FROM devices
                        WHERE profile_id=? AND revoked=0 AND push_json IS NOT NULL''',
                        (profile_id,)).fetchall()
    for row in rows:
        await _send_push(row,event)

async def scheduler():
    next_market=next_news=0
    while True:
        try:
            epoch=time.monotonic()
            if epoch>=next_market:
                next_market=epoch+60
                if os.getenv('AT_QUOTES_ENABLED','true')=='true':await check_market(dispatch)
            if epoch>=next_news:
                next_news=epoch+60
                if os.getenv('AT_NEWS_ENABLED','true')=='true':await check_news(dispatch)
        except Exception:
            log.exception('Worker poll failed; no push for uncertain data')
        await asyncio.sleep(30)
