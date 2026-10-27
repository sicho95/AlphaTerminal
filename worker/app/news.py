"""Classement conservateur des news: pertinence par titre, ISIN, secteur et ETF.
L'impact est un niveau de vigilance, pas une prévision de rendement.
"""
import asyncio
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urlparse
from xml.etree import ElementTree as ET
import httpx
from .db import read_db,transaction,now,new_id,compact

FEEDS = {
    'Café de la Bourse':'https://www.cafedelabourse.com/feed',
    'AMF':'https://www.amf-france.org/fr/flux-rss/display/29',
    'BCE':'https://www.ecb.europa.eu/rss/press.html',
}
TOPICS = {
    'taux':['bce','fed','banque centrale','taux directeur','taux directeurs','interest rate','fomc'],
    'inflation':['inflation','cpi','pce','prix a la consommation'],
    'energie':['petrole','brent','gaz','gas','oil','opep','opec'],
    'geopolitique':['sanctions','tarifs douaniers','tariffs','guerre commerciale','export controls','embargo'],
    'tech':['semi conducteur','semiconductor','intelligence artificielle','data center','gpu','cloud'],
    'credit':['defaut','default','downgrade','liquidite','liquidity']
}
HIGH=['suspension de cotation','profit warning','avertissement sur resultats','offre publique','opa','faillite','bankruptcy','sanctions','retrait de previsions','guidance cut','guidance lowered']
MEDIUM=['resultats','earnings','previsions','guidance','acquisition','merger','taux directeur','taux directeurs','inflation','tariffs','embargo']
SECTOR_MAP={'technology':['tech'],'ia':['tech'],'tech':['tech'],'energy':['energie'],'energie':['energie'],
    'world':['taux','inflation','geopolitique'],'europe':['taux','inflation','energie'],
    'emerging':['geopolitique','inflation'],'technology':['tech'],'semi-conducteurs':['tech'],'finance':['taux','credit'],'obligations':['taux','inflation']}

def norm(value):
    value=unicodedata.normalize('NFKD',str(value or '').lower())
    return ''.join(c for c in value if not unicodedata.combining(c))

def tokens(value):
    return re.sub(r'[^a-z0-9]+',' ',norm(value)).strip()

def exact(text,phrase):
    phrase=tokens(phrase)
    return len(phrase)>=3 and bool(re.search(r'(?<!\w)'+re.escape(phrase)+r'(?!\w)',text))

def is_etf(position):
    s=tokens(position.get('name','')+' '+position.get('assetClass',''))
    return 'etf' in s or 'msci' in s or 'ucits' in s or 'trackers' in s

def score_article(article, positions):
    title=tokens(article.get('title',''))
    snippet=tokens(article.get('summary',''))
    all_text=f'{title} {snippet}'
    themes={k for k,words in TOPICS.items() if any(exact(all_text,w) for w in words)}
    material=any(exact(all_text,w) for w in HIGH)
    moderate=any(exact(all_text,w) for w in MEDIUM)
    matches=[]
    for p in positions:
        name=tokens(p.get('name',''))
        # Generic common words/tickers are not sufficient evidence of company mention.
        alias=[name] if len(name)>=7 and len(name.split())<=7 else []
        if p.get('isin') and len(p['isin'])==12:alias.append(p['isin'])
        ticker=str(p.get('yahooTicker') or p.get('ticker') or '').split('.')[0]
        if 4<=len(ticker)<=10 and re.fullmatch(r'[A-Z0-9]+',ticker.upper()) and ticker.upper() not in {'WORLD','ACTION','ACTIONS','EUROPE','NASDAQ'}:alias.append(ticker)
        named=any(exact(all_text,a) for a in alias)
        sector=tokens(p.get('sector',''))
        exposed=bool(themes.intersection(SECTOR_MAP.get(sector,[])))
        if named or (exposed and is_etf(p)):
            matches.append({'ticker':p.get('ticker',''), 'reason':'entreprise citée' if named else f'exposition ETF {sector}',
                            'direct':named})
    direct=any(m['direct'] for m in matches)
    relevance=3 if direct else (2 if matches else 0)
    # A macro headline alone is not sufficient to push to a user.
    importance=(3 if material else (2 if moderate else 1)) if relevance else 0
    return {'relevance':relevance,'importance':importance, 'themes':sorted(themes), 'matches':matches,
            'level':'critical' if direct and material else ('important' if matches and (moderate or material) else 'info')}

def parse_rss(raw,provider):
    root=ET.fromstring(raw)
    items=[]
    for item in root.findall('.//item')[:25]:
        title=item.findtext('title',''); link=item.findtext('link','')
        if link.startswith('https://') and title:items.append({'title':title,'url':link,'source':provider,'summary':item.findtext('description','')[:500]})
    return items

async def collect_news(search_terms=()):
    out=[]
    async with httpx.AsyncClient(timeout=12,headers={'User-Agent':'AlphaTerminalWorker/1.1'}) as client:
        try:
            r=await client.get('https://ok.surf/api/v1/news-feed');r.raise_for_status()
            body=r.json()
            # OKSURF currently exposes section -> article lists.
            collections=body.values() if isinstance(body,dict) else [body]
            for section in collections:
                if isinstance(section,list):
                    for a in section[:25]:
                        if isinstance(a,dict) and a.get('title') and str(a.get('link','')).startswith('https://'):
                            out.append({'title':a['title'],'url':a['link'],'source':a.get('source','OKSURF'),'summary':''})
        except (httpx.HTTPError,ValueError,TypeError):pass
        # Portefeuille ciblé : les sociétés de taille modeste ne figurent pas toujours
        # dans les grands flux macro. Limiter les requêtes Yahoo (API non officielle).
        for term in search_terms[:8]:
            try:
                r=await client.get('https://query1.finance.yahoo.com/v1/finance/search',params={
                    'q':term,'newsCount':6,'quotesCount':0,'lang':'fr-FR','region':'FR'})
                r.raise_for_status()
                for a in r.json().get('news',[]):
                    link=a.get('link','')
                    if link.startswith('https://') and a.get('title'):
                        out.append({'title':a['title'],'url':link,'source':a.get('publisher','Yahoo Finance'),'summary':''})
            except (httpx.HTTPError,ValueError,TypeError):pass
        for label,url in FEEDS.items():
            try:
                r=await client.get(url);r.raise_for_status()
                out.extend(parse_rss(r.text,label))
            except (httpx.HTTPError,ET.ParseError):pass
        try:
            r=await client.get('https://api.gdeltproject.org/api/v2/doc/doc',params={
               'query':'("stock market" OR inflation OR "central bank" OR earnings)',
               'mode':'artlist','format':'json','maxrecords':30,'timespan':'1d'})
            r.raise_for_status()
            for a in r.json().get('articles',[]):
                if str(a.get('url','')).startswith('https://'):
                    out.append({'title':a.get('title',''),'url':a['url'],'source':'GDELT','summary':''})
        except (httpx.HTTPError,ValueError,TypeError):pass
    unique={}
    for a in out:
        key=hashlib.sha256((a['url'].split('#')[0]).encode()).hexdigest()
        unique[key]=a
    return list(unique.values())[:250]

async def check_news(dispatch):
    with read_db() as c:
        profiles=c.execute('SELECT id,settings_json,data_json,news_initialized FROM profiles').fetchall()
    terms=[]
    for p in profiles:
        settings=json.loads(p['settings_json'])
        if not settings.get('dynamicEnabled') or not settings.get('alertNewsEnabled',True):continue
        for pf in json.loads(p['data_json']).get('portfolios',[]):
            for pos in pf.get('positions',[]):
                if not is_etf(pos):
                    term=str(pos.get('yahooTicker') or pos.get('ticker') or '').strip()
                    if re.fullmatch(r'[A-Za-z0-9.\-]{2,25}',term):terms.append(term)
    terms=sorted(set(terms))
    if terms:
        offset=(int(datetime.now(timezone.utc).timestamp())//1800*8)%len(terms)
        terms=(terms+terms)[offset:offset+8]
    articles=await collect_news(terms)
    for p in profiles:
        settings=json.loads(p['settings_json'])
        if not settings.get('dynamicEnabled') or not settings.get('alertNewsEnabled',True):continue
        initialize=not p['news_initialized']
        data=json.loads(p['data_json'])
        positions=[pos for portfolio in data.get('portfolios',[]) for pos in portfolio.get('positions',[])]
        for a in articles:
            evaluation=score_article(a,positions)
            if evaluation['level']=='info':continue
            news_id=hashlib.sha256(a['url'].split('#')[0].encode()).hexdigest()
            with transaction() as db:
                existed=db.execute('SELECT 1 FROM seen_news WHERE profile_id=? AND article_hash=?',(p['id'],news_id)).fetchone()
                if existed:continue
                db.execute('INSERT INTO seen_news(profile_id,article_hash,created_at) VALUES(?,?,?)',(p['id'],news_id,now()))
                if initialize: continue
                payload={'id':new_id('news'),'title':a['title'][:160],
                         'message':f"{a['source']} · {evaluation['matches'][0]['reason']} · importance {evaluation['level']}",
                         'url':a['url'],'type':'news','severity':'warning' if evaluation['level']=='important' else 'error',
                         'impact':evaluation,'timestamp':now()}
                db.execute('INSERT INTO alerts(id,profile_id,kind,dedup_key,payload_json,created_at) VALUES(?,?,?,?,?,?)',
                    (payload['id'],p['id'],'news',news_id,compact(payload),now()))
            if not initialize: await dispatch(p['id'],payload)
        if initialize:
            with transaction() as db:
                db.execute('UPDATE profiles SET news_initialized=1 WHERE id=?',(p['id'],))
