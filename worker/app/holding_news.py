"""Holding-specific news for a private NAS profile; never a generic macro feed.

Google News RSS, Yahoo Finance search and GDELT are independent public sources.
Per-position SQLite cache and small concurrent batches protect the QNAP worker.
"""
import asyncio
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode
from xml.etree import ElementTree as ET
import httpx
from .db import read_db, transaction

log=logging.getLogger('alphaterminal.holding_news')
SYMBOL=re.compile(r'^[A-Za-z0-9.\-^=]{2,32}$')
ISIN=re.compile(r'^[A-Z]{2}[A-Z0-9]{9}[0-9]$')
CACHE_SECONDS=20*60
MAX_POSITIONS_PER_PAGE=6
MAX_NEWS_PER_INSTRUMENT=4

def aliases(position):
    isin=str(position.get('isin') or '').strip().upper()
    symbol=str(position.get('yahooTicker') or '').strip().upper()
    ticker=str(position.get('ticker') or '').strip().upper()
    result=[]
    if ISIN.fullmatch(isin):result.append('isin:'+isin)
    if symbol:result.append('symbol:'+symbol)
    if ticker and ticker!=symbol:result.append('symbol:'+ticker)
    return result

def position_key(position):
    """Canonical instrument ID, NOT a portfolio position ID."""
    values=aliases(position)
    return next((k for k in values if k.startswith('isin:')),None) or (
        next((k for k in values if k.startswith('symbol:')),None) or
        'position:'+str(position.get('id') or position.get('name') or '').upper())

def eligible_positions(data):
    groups=[]
    for portfolio in data.get('portfolios',[]):
        for position in portfolio.get('positions',[]):
            try:quantity=float(position.get('qty') or 0)
            except (ValueError,TypeError):continue
            if quantity<=0:continue
            kind=str(position.get('assetClass','')).lower()
            if any(word in kind for word in ('liquid','cash','crypto')):continue
            symbol=str(position.get('yahooTicker') or position.get('ticker') or '').strip()
            name=str(position.get('name') or '').strip()
            isin=str(position.get('isin') or '').upper().strip()
            if not SYMBOL.fullmatch(symbol) and not (name and len(name)>=5) and not ISIN.fullmatch(isin):continue
            aka=set(aliases(position))
            isin_alias=next((a for a in aka if a.startswith('isin:')),None)
            def compatible(group):
                known=next((a for a in group['aliases'] if a.startswith('isin:')),None)
                return not(isin_alias and known and isin_alias!=known) and bool(group['aliases'] & aka)
            matched=[g for g in groups if compatible(g)]
            try:value=quantity*float(position.get('currentPrice') or 0)
            except (ValueError,TypeError):value=0.
            member={'id':str(position.get('id') or ''),'ticker':symbol[:32],
                    'name':name[:130],'isin':isin if ISIN.fullmatch(isin) else '',
                    'value':value,'qty':quantity,'aliases':aka}
            if not matched:
                groups.append({'aliases':set(aka),'members':[member]})
                continue
            primary=matched[0]
            primary['aliases'].update(aka)
            primary['members'].append(member)
            for extra in matched[1:]:
                primary['aliases'].update(extra['aliases'])
                primary['members'].extend(extra['members'])
                groups.remove(extra)
    result=[]
    for group in groups:
        members=group['members']
        representative=next((p for p in members if p['isin']),members[0])
        key=next((k for k in group['aliases'] if k.startswith('isin:')),None)
        if not key:key=next((k for k in group['aliases'] if k.startswith('symbol:')),None)
        if not key:key=position_key(representative)
        result.append({**representative,'id':key,'value':sum(p['value'] for p in members),
                       'account_count':len(members),
                       'legacy_ids':[p['id'] for p in members if p['id']]})
    return sorted(result,key=lambda item:-item['value'])

def search_terms(position):
    symbol=position['ticker'].split('.')[0]
    name=position['name']
    isin=position['isin']
    # ISIN and full fund name are more discriminating than 'World'/'ETF'.
    company=re.sub(r'\s+',' ',name).strip()[:90]
    company=re.sub(r'\b(?:EURONEXT PARIS|ACC|DIST|CAPITALISANT)\b','',company,flags=re.I).strip()
    selected=company if len(company)>=5 else symbol
    ticker=symbol if 3<=len(symbol)<=8 and not symbol.isdigit() else ''
    google=f'"{selected}"' if selected else ''
    if isin:google+=f' OR "{isin}"'
    elif ticker and ticker.lower() not in selected.lower():google+=f' OR "{ticker}"'
    return selected,google.strip()

def _date(value):
    if isinstance(value,(int,float)):
        try:return datetime.fromtimestamp(value,tz=timezone.utc)
        except (ValueError,OSError,OverflowError):return None
    if not value:return None
    if isinstance(value,str) and re.fullmatch(r'\d{8}T\d{6}Z?',value):
        try:return datetime.strptime(value.rstrip('Z'),'%Y%m%dT%H%M%S').replace(tzinfo=timezone.utc)
        except ValueError:return None
    try:
        dt=parsedate_to_datetime(str(value))
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError,ValueError,IndexError):
        try:
            dt=datetime.fromisoformat(str(value).replace('Z','+00:00'))
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except (TypeError,ValueError):return None

def _article(title,url,publisher,provider,when,position,days):
    if not title or not str(url).startswith('https://'):return None
    dt=_date(when)
    cutoff=datetime.now(timezone.utc)-timedelta(days=days)
    if not dt or dt<cutoff or dt>datetime.now(timezone.utc)+timedelta(days=1):return None
    return {'title':str(title).strip()[:250],'url':str(url)[:1800],
            'source':str(publisher or provider)[:90],'provider':provider,
            'published_at':dt.isoformat(),'ticker':position['ticker'],
            'position_id':position['id'],'holding_name':position['name']}

def parse_google_rss(xml,position,days):
    root=ET.fromstring(xml)
    results=[]
    for item in root.findall('.//item')[:16]:
        title=item.findtext('title','')
        publisher=item.findtext('source','Google Actualités')
        article=_article(title,item.findtext('link',''),publisher,
                         'Google Actualités',item.findtext('pubDate',''),position,days)
        if article:results.append(article)
    return results

async def query_one(client,position,days,sem):
    selected,query=search_terms(position)
    if not selected:return [],['Identifiant du titre insuffisant']
    all_articles=[]
    errors=[]
    async def from_google():
        params=urlencode({'q':f'({query}) when:{days}d','hl':'fr','gl':'FR','ceid':'FR:fr'})
        url='https://news.google.com/rss/search?'+params
        async with sem:
            try:
                r=await client.get(url);r.raise_for_status()
                return parse_google_rss(r.text,position,days)
            except (httpx.HTTPError,ET.ParseError,ValueError) as error:
                errors.append('Google Actualités : '+type(error).__name__)
                return []
    async def from_yahoo():
        symbol=position['ticker']
        if not SYMBOL.fullmatch(symbol):return []
        async with sem:
            try:
                r=await client.get('https://query1.finance.yahoo.com/v1/finance/search',
                                   params={'q':symbol,'newsCount':12,'quotesCount':0,'lang':'fr-FR','region':'FR'})
                r.raise_for_status()
                return [news for n in r.json().get('news',[]) if (news:=_article(
                    n.get('title'),n.get('link'),n.get('publisher'),'Yahoo Finance',
                    n.get('providerPublishTime'),position,days))]
            except (httpx.HTTPError,ValueError,TypeError) as error:
                errors.append('Yahoo Finance : '+type(error).__name__)
                return []
    async def from_gdelt():
        term=selected.replace('"','').replace('(','').replace(')','')[:70]
        async with sem:
            try:
                r=await client.get('https://api.gdeltproject.org/api/v2/doc/doc',
                   params={'query':f'"{term}"','mode':'artlist','format':'json',
                           'maxrecords':12,'timespan':f'{days}d'})
                r.raise_for_status()
                return [news for n in r.json().get('articles',[]) if (news:=_article(
                    n.get('title'),n.get('url'),n.get('domain'),'GDELT',
                    n.get('seendate'),position,days))]
            except (httpx.HTTPError,ValueError,TypeError) as error:
                errors.append('GDELT : '+type(error).__name__)
                return []
    results=await asyncio.gather(from_google(),from_yahoo(),from_gdelt())
    unique={}
    for a in (article for group in results for article in group):
        key=hashlib.sha256(a['url'].split('#')[0].encode()).hexdigest()
        unique[key]=a
    all_articles=sorted(unique.values(),key=lambda x:x['published_at'],reverse=True)
    return all_articles[:MAX_NEWS_PER_INSTRUMENT],errors

async def holdings_news(profile_id,days=7,position_id='',offset=0,portfolio_ids=()):
    with read_db() as db:
        row=db.execute('SELECT data_json FROM profiles WHERE id=? AND disabled=0',(profile_id,)).fetchone()
        if not row:raise ValueError('Profil inexistant')
        data=json.loads(row['data_json'])
        if portfolio_ids:
            allow=set(portfolio_ids)
            data['portfolios']=[p for p in data.get('portfolios',[]) if p.get('id') in allow]
        positions=eligible_positions(data)
    if position_id:
        positions=[p for p in positions if p['id']==position_id or position_id in p.get('legacy_ids',[])]
    total=len(positions)
    selection=positions[max(0,offset):max(0,offset)+MAX_POSITIONS_PER_PAGE]
    if not selection:return {'articles':[],'total_positions':total,'checked_positions':0,
        'offset':offset,'next_offset':None,'source_errors':[],'sources':[]}
    sem=asyncio.Semaphore(5)
    errors=[]
    all_news=[]
    async with httpx.AsyncClient(timeout=7,headers={'User-Agent':'AlphaTerminal/1.2.2'}) as client:
        async def load(position):
            key=hashlib.sha256(json.dumps((position['name'],position['ticker'],
                   position['isin']),sort_keys=True).encode()).hexdigest()
            with read_db() as db:
                cached=db.execute('''SELECT fetched_at,results_json,errors_json FROM holding_news_cache
                     WHERE profile_id=? AND position_key=? AND days=? AND signature=?''',
                     (profile_id,position['id'],days,key)).fetchone()
            if cached and time.time()-cached['fetched_at']<CACHE_SECONDS:
                return json.loads(cached['results_json']),json.loads(cached['errors_json'])
            articles,problems=await query_one(client,position,days,sem)
            with transaction() as db:
                db.execute('''INSERT INTO holding_news_cache
                     (profile_id,position_key,days,signature,fetched_at,results_json,errors_json)
                     VALUES(?,?,?,?,?,?,?)
                     ON CONFLICT(profile_id,position_key,days) DO UPDATE SET
                     signature=excluded.signature,fetched_at=excluded.fetched_at,
                     results_json=excluded.results_json,errors_json=excluded.errors_json''',
                     (profile_id,position['id'],days,key,time.time(),
                      json.dumps(articles),json.dumps(problems)))
            return articles,problems
        for items,problems in await asyncio.gather(*(load(pos) for pos in selection)):
            all_news.extend(items);errors.extend(problems)
    unique={}
    for article in all_news:
        key=article['url'].split('#')[0]
        if key not in unique:unique[key]=article
    result=sorted(unique.values(),key=lambda x:x['published_at'],reverse=True)
    next_offset=offset+len(selection) if offset+len(selection)<total else None
    return {'articles':result[:40],'total_positions':total,
        'checked_positions':len(selection),'offset':offset,'next_offset':next_offset,
        'source_errors':sorted(set(errors)),'sources':['Google Actualités','Yahoo Finance','GDELT']}
