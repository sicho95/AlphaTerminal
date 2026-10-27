"""Source Yahoo commune PWA/NAS et règles harmonisées sur cotations confirmées.
Cotations indicatives: une alerte stop n'est jamais un ordre de courtage.
"""
import asyncio
import os
import re
import json
import math
import time
from datetime import datetime, timezone
import httpx
from .db import read_db,transaction,compact,now,new_id

SYMBOL=re.compile(r'^[A-Z0-9.\-^=]{1,35}$')
LAST_RUN={}
REFRESH_MIN=5
REFRESH_MAX=120

def minutes(value):
    try:
        number=int(float(value))
    except (TypeError,ValueError,OverflowError):
        number=10
    return max(REFRESH_MIN,min(REFRESH_MAX,number))

def watchlist(data):
    for portfolio in data.get('portfolios',[]):
        for pos in portfolio.get('positions',[]):
            symbol=str(pos.get('yahooTicker') or pos.get('ticker') or '').strip().upper()
            if not SYMBOL.fullmatch(symbol):
                continue
            ident=pos.get('id') or pos.get('isin') or symbol
            stop=pos.get('stopLevel')
            pru=pos.get('pru')
            try:stop=float(stop) if stop is not None else 0.
            except (ValueError,TypeError):stop=0.
            try:pru=float(pru) if pru is not None else 0.
            except (ValueError,TypeError):pru=0.
            yield {'symbol':symbol,'stop':stop,'pru':pru,
                'key':f"{portfolio.get('id','')}:{ident}",
                'label':pos.get('name') or symbol,'portfolio':portfolio.get('name','')}

def adjusted_quote(quote,reference):
    """Evenly scale Yahoo GBp/EUR price units as in the local PWA data provider."""
    price=quote['price']
    if not reference or reference<=0:return quote
    candidates=[price*factor for factor in (1,.1,.01,.001,.0001,10,100,1000)]
    chosen=min(candidates,key=lambda x:abs(math.log(x/reference)))
    scale=chosen/price
    if scale==1:return quote
    return {**quote,'price':chosen,
            **{k:[v*scale for v in quote.get(k,[])] for k in ('closes','highs','lows')}}

def calculate_rsi14(values):
    values=[float(x) for x in values if isinstance(x,(int,float)) and math.isfinite(x)]
    if len(values)<15:return None
    gains=losses=0.
    for i in range(len(values)-14,len(values)):
        change=values[i]-values[i-1]
        gains+=max(0.,change)
        losses+=max(0.,-change)
    if losses==0:return 50 if gains==0 else 100
    return 100-100/(1+gains/losses)

def conditions(position,quote,settings):
    """Mêmes seuils que js/market-alerts.js pour une position et une cotation."""
    price=quote['price']
    stop=position['stop']
    pru=position['pru']
    distance=(price-stop)/price*100 if stop>0 else math.inf
    crossed=stop>0 and price<=stop
    near=stop>0 and price>stop and distance<=3
    performance=(price-pru)/pru*100 if pru>0 else math.nan
    rsi=calculate_rsi14(quote.get('closes',[]))
    return {
        'stop':bool(settings.get('alertStopsEnabled',True) and crossed),
        'stop-near':bool(settings.get('alertStopNearEnabled',True) and near),
        'performance':bool(settings.get('alertPerformanceEnabled') and math.isfinite(performance) and performance>=12),
        'rsi-low':bool(settings.get('alertRsiEnabled') and rsi is not None and rsi<25),
        'rsi-high':bool(settings.get('alertRsiEnabled') and rsi is not None and rsi>75)
    }

async def fetch_quotes(symbols):
    result={}
    async with httpx.AsyncClient(timeout=12,headers={'User-Agent':'AlphaTerminal/1.2'}) as client:
        async def fetch(symbol):
            try:
                response=await client.get(f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}',
                                          params={'interval':'1d','range':'1mo'})
                response.raise_for_status()
                item=response.json()['chart']['result'][0]
                meta=item['meta']
                price=meta.get('regularMarketPrice')
                ts=meta.get('regularMarketTime')
                if not isinstance(price,(int,float)) or price<=0 or not ts:return
                age=datetime.now(timezone.utc).timestamp()-ts
                if age<0 or age>4*86400:return
                bars=((item.get('indicators') or {}).get('quote') or [{}])[0].get('close') or []
                closes=[float(v) for v in bars if isinstance(v,(int,float)) and math.isfinite(v)]
                highs=[float(v) for v in (((item.get('indicators') or {}).get('quote') or [{}])[0].get('high') or []) if isinstance(v,(int,float)) and math.isfinite(v)]
                lows=[float(v) for v in (((item.get('indicators') or {}).get('quote') or [{}])[0].get('low') or []) if isinstance(v,(int,float)) and math.isfinite(v)]
                result[symbol]={'price':price,'as_of':int(ts),'closes':closes[-40:],
                                'highs':highs[-40:],'lows':lows[-40:]}
            except (httpx.HTTPError,ValueError,KeyError,IndexError,TypeError):
                return
        # Bound outbound concurrency to limit NAS resources/requests.
        sem=asyncio.Semaphore(4)
        async def bounded(symbol):
            async with sem:await fetch(symbol)
        await asyncio.gather(*(bounded(symbol) for symbol in sorted(symbols)))
    return result

def transition(profile_id,position_id,kind,is_active,payload):
    """Déclenche uniquement false -> true ; conserve l'état durant les pannes."""
    with transaction() as db:
        row=db.execute('SELECT active FROM alert_states WHERE profile_id=? AND position_id=? AND kind=?',
                       (profile_id,position_id,kind)).fetchone()
        was_active=bool(row['active']) if row else False
        db.execute('''INSERT INTO alert_states(profile_id,position_id,kind,active) VALUES(?,?,?,?)
             ON CONFLICT(profile_id,position_id,kind) DO UPDATE SET active=excluded.active''',
             (profile_id,position_id,kind,int(is_active)))
        if is_active and not was_active:
            payload={'id':new_id('alert'),**payload,'timestamp':now()}
            db.execute('INSERT INTO alerts(id,profile_id,kind,dedup_key,payload_json,created_at) VALUES(?,?,?,?,?,?)',
                       (payload['id'],profile_id,kind,payload['id'],compact(payload),now()))
            return payload
    return None

def event_payload(position,quote,kind):
    name=position['label']
    price=quote['price']
    stop=position['stop']
    ticker=position['symbol']
    if kind=='stop':
        title,message=f'Stop franchi — {name}',f'{ticker} : cours {price:.3f}, seuil {stop:.3f}'
    elif kind=='stop-near':
        title,message=f'Stop proche — {name}',f'{ticker} : cours {price:.3f}, seuil {stop:.3f}'
    elif kind=='performance':
        performance=(price-position['pru'])/position['pru']*100
        title,message=f'Performance +12 % — {name}',f'{ticker} : performance latente {performance:.1f} %'
    else:
        rsi=calculate_rsi14(quote.get('closes',[]))
        title=f'RSI {"faible" if kind=="rsi-low" else "élevé"} — {name}'
        message=f'{ticker} : RSI(14) {rsi:.1f}'
    return {'title':title,'message':message+'. Cotation indicative.',
            'type':'rsi' if kind.startswith('rsi-') else kind,
            'severity':'error' if kind=='stop' else 'success' if kind=='performance' else 'warning',
            'ticker':ticker,'as_of':quote['as_of']}

async def check_market(dispatch):
    with read_db() as db:
        profiles=db.execute('SELECT id,settings_json,data_json FROM profiles WHERE disabled=0').fetchall()
    due=[]
    epoch=time.monotonic()
    for p in profiles:
        settings=json.loads(p['settings_json'])
        if not settings.get('dynamicEnabled'):continue
        interval=minutes(settings.get('autoRefreshMinutes'))*60
        if epoch-LAST_RUN.get(p['id'],-1e10)<interval:continue
        LAST_RUN[p['id']]=epoch
        data=json.loads(p['data_json'])
        due.append((p['id'],settings,list(watchlist(data))))
    watches={w['symbol'] for _,_,positions in due for w in positions}
    if not watches:return
    quotes=await fetch_quotes(watches)
    for profile,settings,positions in due:
        for pos in positions:
            quote=quotes.get(pos['symbol'])
            if quote is None:continue
            quote=adjusted_quote(quote,pos['pru'])
            with transaction() as db:
                db.execute('''INSERT INTO market_quotes(profile_id,position_key,symbol,price,as_of,closes_json,highs_json,lows_json,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(profile_id,position_key) DO UPDATE SET
                    symbol=excluded.symbol,price=excluded.price,as_of=excluded.as_of,
                    closes_json=excluded.closes_json,highs_json=excluded.highs_json,
                    lows_json=excluded.lows_json,updated_at=excluded.updated_at''',
                    (profile,pos['key'],pos['symbol'],quote['price'],quote['as_of'],
                     compact(quote.get('closes',[])),compact(quote.get('highs',[])),
                     compact(quote.get('lows',[])),now()))
            for kind,active in conditions(pos,quote,settings).items():
                event=transition(profile,pos['key'],kind,active,event_payload(pos,quote,kind) if active else {})
                if event:await dispatch(profile,event)
