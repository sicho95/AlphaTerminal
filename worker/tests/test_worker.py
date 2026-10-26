import importlib
import os
import tempfile
import unittest
from fastapi.testclient import TestClient

from app.db import init,transaction,apply_changes,Conflict,profile_state,connect
from app.market import transition,watchlist
from app.news import score_article

class WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        os.environ['AT_DATA_DIR']=cls.tmp.name
        os.environ['AT_BOOTSTRAP_CODE']='test-admin-secret-12345678901234567890'
        os.environ['AT_QUOTES_ENABLED']='false'
        os.environ['AT_NEWS_ENABLED']='false'
        init()
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def test_profile_and_cas(self):
        with transaction() as db:
            db.execute("INSERT INTO profiles(id,name,created_at) VALUES('p','Test','now')")
            p=apply_changes(db,'p',{'settings_patch':{'autoRefreshMinutes':10},'settings_base_rev':0})
            self.assertEqual(p['settings_rev'],1)
            p=apply_changes(db,'p',{'settings_patch':{'darkMode':True},'settings_base_rev':0})
            self.assertEqual(p['settings_rev'],2)
            with self.assertRaises(Conflict):apply_changes(db,'p',{'settings_patch':{'darkMode':False},'settings_base_rev':0})
            p=apply_changes(db,'p',{'data':{'owners':[],'portfolios':[]},'data_base_rev':0})
            self.assertEqual(p['data_rev'],1)
            with self.assertRaises(Conflict):apply_changes(db,'p',{'data':{'owners':[]},'data_base_rev':0})
    def test_stop_transition(self):
        payload={'title':'2CRSI','message':'cours','type':'stop','severity':'error'}
        self.assertIsNotNone(transition('p','row1','stop',True,payload))
        self.assertIsNone(transition('p','row1','stop',True,payload))
        self.assertIsNone(transition('p','row1','stop',False,payload))
        self.assertIsNotNone(transition('p','row1','stop',True,payload))
    def test_lookups(self):
        data={'portfolios':[{'id':'A','positions':[{'id':'B','ticker':'2CRSI.PA','stopLevel':27.5}]}]}
        self.assertEqual(next(watchlist(data))['symbol'],'2CRSI.PA')
        self.assertEqual(list(watchlist({'portfolios':[{'positions':[{'ticker':'../../etc/passwd','stopLevel':25}]}]})),[])
    def test_news_filter(self):
        portfolio=[{'ticker':'2CRSI','name':'2CRSI','sector':'Tech','assetClass':'Actions'}]
        x=score_article({'title':'2CRSI publie un profit warning','summary':''},portfolio)
        self.assertEqual(x['level'],'critical')
        self.assertEqual(score_article({'title':'Pluie en Normandie'},portfolio)['level'],'info')
        etf=[{'name':'Amundi MSCI World UCITS ETF','ticker':'CW8.PA','sector':'World'}]
        self.assertEqual(score_article({'title':'La BCE relève les taux directeurs'},etf)['level'],'important')
        self.assertEqual(score_article({'title':'2CRSI : petite annonce'},etf)['level'],'info')
    def test_auth_pair_sync(self):
        from app.main import app
        with TestClient(app) as client:
            r=client.post('/api/v1/setup/add-profile',json={'code':os.environ['AT_BOOTSTRAP_CODE'],'profile_name':'Damien','device_name':'iPhone'})
            self.assertEqual(r.status_code,200,r.text)
            bearer={'Authorization':'Bearer '+r.json()['token']}
            r=client.post('/api/v1/sync/changes',headers=bearer,json={'settings_patch':{'dynamicEnabled':True},'settings_base_rev':0})
            self.assertEqual(r.status_code,200,r.text)
            r=client.post('/api/v1/pair/start',json={'device_name':'Mac'})
            self.assertEqual(r.status_code,200,r.text)
            pair=r.json()
            r=client.post('/api/v1/pair/approve',headers=bearer,json={'code':pair['code']})
            self.assertEqual(r.status_code,200,r.text)
            r=client.post('/api/v1/pair/claim',json={'request_id':pair['request_id'],'claim_secret':pair['claim_secret']})
            self.assertEqual(r.status_code,200,r.text)
            bearer2={'Authorization':'Bearer '+r.json()['token']}
            r=client.get('/api/v1/sync/state',headers=bearer2)
            self.assertTrue(r.json()['settings']['dynamicEnabled'])
            self.assertEqual(client.get('/api/v1/sync/state').status_code,401)
            self.assertEqual(client.post('/api/v1/pair/claim',json={'request_id':pair['request_id'],'claim_secret':pair['claim_secret']}).status_code,410)
            self.assertEqual(client.post('/api/v1/sync/changes',headers=bearer2,json={'settings_patch':{'marketauxApiKey':'TOKEN'},'settings_base_rev':1}).status_code,422)
            self.assertEqual(client.post('/api/v1/sync/changes',headers=bearer2,json={'settings_patch':{'dynamicEnabled':False},'settings_base_rev':0}).status_code,409)

if __name__=='__main__':unittest.main()
