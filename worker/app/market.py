"""Cotations partagées. Les stops sont des alertes indicatives, jamais des ordres boursiers."""
import asyncio
import os
import re
import json
from datetime import datetime, timezone
import httpx
from .db import read_db, transaction, compact, now, new_id

SYMBOL = re.compile(r'^[A-Z0-9.\-^=]{1,35}$')

def watchlist(data):
    for portfolio in data.get('portfolios',[]):
        for position in portfolio.get('positions',[]):
            symbol = (position.get('yahooTicker') or position.get('ticker') or '').strip().upper()
            if not SYMBOL.fullmatch(symbol): continue
            if not position.get('stopLevel'): continue
            yield {'symbol':symbol,'stop':float(position['stopLevel']),
                'key':f"{portfolio.get('id','')}:{position.get('id') or position.get('isin') or symbol}",
                'label':position.get('name') or symbol, 'portfolio':portfolio.get('name','')}

async def fetch_quotes(symbols):
    result={}
    async with httpx.AsyncClient(timeout=12, headers={'User-Agent':'AlphaTerminal/1.1'}) as client:
        for symbol in sorted(symbols):
            try:
                response=await client.get(f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}',params={'interval':'1d','range':'5d'})
                response.raise_for_status()
                meta=response.json()['chart']['result'][0]['meta']
                price=meta.get('regularMarketPrice')
                ts=meta.get('regularMarketTime')
                if not isinstance(price,(int,float)) or price<=0 or not ts: continue
                age=(datetime.now(timezone.utc).timestamp()-ts)
                if age<0 or age>4*86400: continue # Ignore stale prices.
                result[symbol]={'price':price, 'as_of':ts}
            except (httpx.HTTPError,ValueError,KeyError,IndexError,TypeError):
                continue
    return result

def transition(profile_id, position_id, kind, is_active, payload):
    """Fires on false->true only, per profile/position; conserves states across outages."""
    with transaction() as db:
        row=db.execute('SELECT active FROM alert_states WHERE profile_id=? AND position_id=? AND kind=?',
                       (profile_id,position_id,kind)).fetchone()
        was_active=bool(row['active']) if row else False
        db.execute('INSERT INTO alert_states(profile_id,position_id,kind,active) VALUES(?,?,?,?) '
                   'ON CONFLICT(profile_id,position_id,kind) DO UPDATE SET active=excluded.active',
                   (profile_id,position_id,kind,int(is_active)))
        if is_active and not was_active:
            payload={'id':new_id('alert'), **payload,'timestamp':now()}
            db.execute('INSERT INTO alerts(id,profile_id,kind,dedup_key,payload_json,created_at) VALUES(?,?,?,?,?,?)',
                       (payload['id'],profile_id,kind,payload['id'],compact(payload),now()))
            return payload
    return None

async def check_market(dispatch):
    with read_db() as db:
        profiles=db.execute('SELECT id,settings_json,data_json FROM profiles').fetchall()
    watches=[]
    for p in profiles:
        settings=json.loads(p['settings_json'])
        if not settings.get('dynamicEnabled'):continue
        data=json.loads(p['data_json'])
        for w in watchlist(data): watches.append((p['id'],settings,w))
    quotes=await fetch_quotes({w['symbol'] for _,_,w in watches})
    for profile,settings,w in watches:
        quote=quotes.get(w['symbol'])
        if quote is None:continue
        price,stop=quote['price'],w['stop']
        active=price<=stop
        near=stop<price<=stop*1.03
        for kind,condition,enabled in [('stop',active,settings.get('alertStopsEnabled',True)),
                                       ('stop-near',near,settings.get('alertStopNearEnabled',True))]:
            event=transition(profile,w['key'],kind,bool(condition and enabled),{
                'title':f"{'Stop franchi' if kind=='stop' else 'Stop proche'} — {w['label']}",
                'message':f"{w['symbol']} : cours {price:.3f}, stop {stop:.3f}. Cotation indicative.",
                'type':kind,'severity':'error' if kind=='stop' else 'warning',
                'ticker':w['symbol'],'as_of':quote['as_of']})
            if event: await dispatch(profile,event)
