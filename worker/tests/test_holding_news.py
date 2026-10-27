"""No live provider access: deterministic holding news and API privacy regression tests."""
import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.db import init,transaction
from app.holding_news import (
    eligible_positions,search_terms,_date,parse_google_rss,holdings_news
)

class HoldingNewsTests(unittest.TestCase):
    def test_only_actual_holdings_and_scope(self):
        data={'portfolios':[{'id':'pea','positions':[
          {'id':'a','name':'Entreprise Exemple SA','ticker':'EXMP.PA','qty':5,'currentPrice':100},
          {'id':'b','name':'LCL Sérénité','ticker':'NONCOTE','qty':3,'assetClass':'Liquidités'},
          {'id':'c','name':'Entreprise vendue','ticker':'OLD.PA','qty':0},
          {'id':'d','name':'Un autre titre','ticker':'OTHR.PA','qty':2,'currentPrice':8}
        ]}]}
        result=eligible_positions(data)
        self.assertEqual([x['id'] for x in result],['a','d'])
        self.assertTrue('EXMP' in search_terms(result[0])[1] or 'Entreprise Exemple' in search_terms(result[0])[1])

    def test_google_rss_and_gdelt_dates_filter(self):
        self.assertEqual(_date('20261027T210000Z'),datetime(2026,10,27,21,tzinfo=timezone.utc))
        yesterday=datetime.now(timezone.utc)-timedelta(days=1)
        too_old=datetime.now(timezone.utc)-timedelta(days=20)
        from email.utils import format_datetime
        xml='<rss><channel><item><title>Entreprise Exemple annonce ses résultats</title>'+\
            '<link>https://example.org/company</link><pubDate>'+format_datetime(yesterday)+'</pubDate>'+\
            '</item><item><title>Ancienne actualité</title><link>https://example.org/old</link>'+\
            '<pubDate>'+format_datetime(too_old)+'</pubDate></item></channel></rss>'
        position={'id':'a','name':'Entreprise Exemple','ticker':'EXMP.PA'}
        one=parse_google_rss(xml,position,7)
        thirty=parse_google_rss(xml,position,30)
        self.assertEqual(len(one),1)
        self.assertEqual(len(thirty),2)
        self.assertEqual(one[0]['provider'],'Google Actualités')

    def test_caches_per_profile_with_small_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            previous=os.environ.get('AT_DATA_DIR')
            os.environ['AT_DATA_DIR']=directory
            try:
                init()
                positions=[{'id':f'pos{i}','name':f'Entreprise test {i}','ticker':f'EX{i}.PA',
                    'qty':1,'currentPrice':100-i} for i in range(7)]
                with transaction() as db:
                    db.execute("INSERT INTO profiles(id,name,data_json,created_at) VALUES(?,?,?,?)",
                        ('profile_test','Essai',json.dumps({'portfolios':[{'id':'portfolio_test',
                            'positions':positions}]}),datetime.now(timezone.utc).isoformat()))
                calls=[]
                async def fake(client,position,days,sem):
                    calls.append(position['id'])
                    return [{'title':'Résultats','url':'https://example.org/'+position['id'],
                             'published_at':datetime.now(timezone.utc).isoformat(),
                             'position_id':position['id'],'ticker':position['ticker'],
                             'holding_name':position['name'],'source':'Test','provider':'Test'}],[]
                with patch('app.holding_news.query_one',new=fake):
                    first=asyncio.run(holdings_news('profile_test',7,offset=0,portfolio_ids=['portfolio_test']))
                    self.assertEqual(first['checked_positions'],6)
                    self.assertEqual(first['next_offset'],6)
                    self.assertEqual(len(first['articles']),6)
                    self.assertEqual(len(calls),6)
                    repeat=asyncio.run(holdings_news('profile_test',7,offset=0,portfolio_ids=['portfolio_test']))
                    self.assertEqual(len(repeat['articles']),6)
                    self.assertEqual(len(calls),6)
                    second=asyncio.run(holdings_news('profile_test',7,offset=6,portfolio_ids=['portfolio_test']))
                    self.assertEqual(second['checked_positions'],1)
                    self.assertIsNone(second['next_offset'])
                    self.assertEqual(len(calls),7)
                    empty=asyncio.run(holdings_news('profile_test',7,portfolio_ids=['other']))
                    self.assertEqual(empty['articles'],[])
            finally:
                if previous is None:os.environ.pop('AT_DATA_DIR',None)
                else:os.environ['AT_DATA_DIR']=previous

    def test_auth_gate_and_no_arbitrary_portfolio_search(self):
        from app.main import app
        from app.main import ATTEMPTS
        ATTEMPTS.clear()
        with tempfile.TemporaryDirectory() as directory:
            previous=os.environ.get('AT_DATA_DIR')
            os.environ['AT_DATA_DIR']=directory
            try:
                with TestClient(app) as client:
                    profile=client.post('/api/v1/profiles/create',json={
                        'profile_name':'Actualités tests','device_name':'Téléphone'
                    })
                    self.assertEqual(profile.status_code,200,profile.text)
                    header={'Authorization':'Bearer '+profile.json()['token']}
                    self.assertEqual(client.get('/api/v1/holdings/news').status_code,401)
                    self.assertEqual(client.get('/api/v1/holdings/news?days=60',
                        headers=header).status_code,422)
                    answer=client.get('/api/v1/holdings/news?days=7&portfolio_ids=absent',
                                      headers=header)
                    self.assertEqual(answer.status_code,200,answer.text)
                    self.assertEqual(answer.json()['articles'],[])
            finally:
                if previous is None:os.environ.pop('AT_DATA_DIR',None)
                else:os.environ['AT_DATA_DIR']=previous

if __name__=='__main__':unittest.main()
