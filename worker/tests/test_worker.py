import importlib
import os
import tempfile
import unittest
from fastapi.testclient import TestClient

from app.db import init,transaction,apply_changes,Conflict,profile_state,connect
from app.market import transition,watchlist,conditions,calculate_rsi14,calculate_atr,suggested_stop,RULES,minutes
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
    def setUp(self):
        # Les cas d'essai partagent localhost, mais doivent conserver des quotas isolés.
        from app.main import ATTEMPTS
        ATTEMPTS.clear()
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
    def test_public_profile_recovery_preserves_one_nas_profile(self):
        from app.main import app
        from app.security import read_recovery
        with TestClient(app) as client:
            created=client.post('/api/v1/profiles/create',json={
                'profile_name':'Famille-test','device_name':'Telephone A'})
            self.assertEqual(created.status_code,200,created.text)
            profile=created.json()
            self.assertGreaterEqual(len(profile['recovery_secret']),40)
            first={'Authorization':'Bearer '+profile['token']}
            self.assertEqual(client.get('/api/v1/sync/state').status_code,401)
            recovery=client.get('/api/v1/profiles/recovery',headers=first)
            self.assertEqual(recovery.status_code,200,recovery.text)
            self.assertEqual(recovery.json()['recovery_secret'],profile['recovery_secret'])
            saved=client.post('/api/v1/sync/changes',headers=first,json={
                'settings_patch':{'dynamicEnabled':True},'settings_base_rev':0,
                'data':{'owners':[],'portfolios':[]},'data_base_rev':0
            })
            self.assertEqual(saved.status_code,200,saved.text)
            rejected=client.post('/api/v1/profiles/recover',json={
                'profile_id':profile['profile_id'],'recovery_secret':'X'*55,
                'device_name':'Attaquant'})
            self.assertEqual(rejected.status_code,401,rejected.text)
            second=client.post('/api/v1/profiles/recover',json={
                'profile_id':profile['profile_id'],
                'recovery_secret':profile['recovery_secret'],
                'device_name':'Telephone B'})
            self.assertEqual(second.status_code,200,second.text)
            self.assertNotEqual(second.json()['device_id'],profile['device_id'])
            self.assertEqual(second.json()['profile_id'],profile['profile_id'])
            bearer={'Authorization':'Bearer '+second.json()['token']}
            restored=client.get('/api/v1/sync/state',headers=bearer)
            self.assertEqual(restored.status_code,200)
            self.assertTrue(restored.json()['settings']['dynamicEnabled'])
            with transaction() as db:
                self.assertEqual(db.execute(
                    'SELECT COUNT(*) FROM profiles WHERE id=?',(profile['profile_id'],)).fetchone()[0],1)
                self.assertEqual(read_recovery(db,profile['profile_id']),profile['recovery_secret'])

    def test_administration_suspension_and_deletion(self):
        from app.main import app
        with TestClient(app) as client:
            created=client.post('/api/v1/profiles/create',json={
                'profile_name':'Profil-a-supprimer','device_name':'Appareil-test'})
            self.assertEqual(created.status_code,200,created.text)
            result=created.json()
            bearer={'Authorization':'Bearer '+result['token']}
            admin={'X-Admin-Key':os.environ['AT_BOOTSTRAP_CODE']}
            self.assertEqual(client.get('/api/v1/admin/profiles').status_code,403)
            self.assertEqual(client.get('/api/v1/admin/profiles',headers=admin).status_code,200)
            profile_id=result['profile_id']
            suspended=client.post('/api/v1/admin/profiles/'+profile_id+'/status',
                                  headers=admin,json={'disabled':True})
            self.assertEqual(suspended.status_code,200,suspended.text)
            self.assertEqual(client.get('/api/v1/sync/state',headers=bearer).status_code,401)
            self.assertEqual(client.post('/api/v1/profiles/recover',json={
                'profile_id':profile_id,'recovery_secret':result['recovery_secret'],
                'device_name':'Appareil-test2'}).status_code,401)
            self.assertEqual(client.post('/api/v1/admin/profiles/'+profile_id+'/status',
                headers=admin,json={'disabled':False}).status_code,200)
            self.assertEqual(client.get('/api/v1/sync/state',headers=bearer).status_code,200)
            path='/api/v1/admin/profiles/'+profile_id
            self.assertEqual(client.request('DELETE',path,headers=admin,
                json={'confirm_name':'Faux profil'}).status_code,409)
            self.assertEqual(client.request('DELETE',path,headers=admin,
                json={'confirm_name':'Profil-a-supprimer'}).status_code,200)
            self.assertEqual(client.get('/api/v1/sync/state',headers=bearer).status_code,401)

    def test_monitor_rules_and_per_investor_atr(self):
        import json
        from pathlib import Path
        manifest=json.loads((Path(__file__).resolve().parents[2]/'shared'/'monitor-rules.json').read_text())
        self.assertEqual(RULES,manifest)
        self.assertEqual(minutes(2),5)
        self.assertEqual(minutes(200),120)
        closes=[float(90+i) for i in range(35)]
        highs=[x+1 for x in closes]
        lows=[x-1 for x in closes]
        quote={'price':130.,'closes':closes,'highs':highs,'lows':lows}
        position={'stop':125,'pru':110,'profile_id':'offensif','atr_multiplier_override':None}
        settings={'alertStopsEnabled':True,'alertStopNearEnabled':True,
                  'alertPerformanceEnabled':True,'alertRsiEnabled':True,
                  'investorProfiles':{'offensif':{'atrMultiplier':4}}}
        indicators=suggested_stop(position,quote,settings)
        self.assertEqual(indicators['atr_multiplier'],4.)
        self.assertAlmostEqual(indicators['suggested_stop'],130-indicators['atr14']*4)
        position['atr_multiplier_override']=2.5
        self.assertEqual(suggested_stop(position,quote,settings)['atr_multiplier'],2.5)
        conditions_result=conditions(position,quote,settings)
        self.assertFalse(conditions_result['stop'])
        self.assertFalse(conditions_result['stop-near'])
        self.assertTrue(conditions_result['performance'])
        self.assertIsNotNone(calculate_rsi14(closes))
        self.assertIsNotNone(calculate_atr(highs,lows,closes))
        self.assertEqual(set(conditions_result),{'stop','stop-near','performance','rsi-low','rsi-high'})

    def test_simple_pairing_and_monitoring_contract(self):
        from app.main import app
        with TestClient(app) as client:
            created=client.post('/api/v1/profiles/create',
                json={'profile_name':'Paired-test','device_name':'iPhone'})
            self.assertEqual(created.status_code,200,created.text)
            first=created.json()
            headers={'Authorization':'Bearer '+first['token']}
            saved=client.post('/api/v1/sync/changes',headers=headers,json={
                'settings_patch':{'dynamicEnabled':True,'autoRefreshMinutes':5},
                'settings_base_rev':0,
                'data':{'owners':[],'portfolios':[]},'data_base_rev':0})
            self.assertEqual(saved.status_code,200,saved.text)
            pair=client.post('/api/v1/pair/invite',headers=headers)
            self.assertEqual(pair.status_code,200,pair.text)
            code=pair.json()['code']
            self.assertEqual(len(code),6)
            join=client.post('/api/v1/pair/join',json={
                'code':code,'device_name':'Mac'})
            self.assertEqual(join.status_code,200,join.text)
            self.assertEqual(join.json()['profile_id'],first['profile_id'])
            self.assertNotEqual(join.json()['device_id'],first['device_id'])
            self.assertEqual(client.post('/api/v1/pair/join',json={
                'code':code,'device_name':'Fake'}).status_code,404)
            with transaction() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM profiles WHERE id=?',
                    (first['profile_id'],)).fetchone()[0],1)
            monitor=client.get('/api/v1/monitor/state',headers=headers)
            self.assertEqual(monitor.status_code,200,monitor.text)
            self.assertEqual(monitor.json()['contract_version'],2)
            self.assertEqual(monitor.json()['rule_version'],RULES['rule_version'])
            self.assertEqual(client.get('/api/v1/monitor/state').status_code,401)
            status=client.get('/api/v1/push/status',headers=headers)
            self.assertEqual(status.status_code,200,status.text)
            self.assertEqual(status.json()['subscribed'],False)
            self.assertEqual(status.json()['dynamic_enabled'],True)
            invalid=client.post('/api/v1/sync/changes',headers=headers,json={
                'settings_patch':{'autoRefreshMinutes':2},'settings_base_rev':1})
            self.assertEqual(invalid.status_code,422)

    def test_server_web_push_submission_without_active_pwa(self):
        import asyncio
        from unittest.mock import patch
        from app.main import app,_send_push
        from app.db import read_db
        with TestClient(app) as client:
            created=client.post('/api/v1/profiles/create',json={
                'profile_name':'WebPush-test','device_name':'iPhone hors ligne'})
            self.assertEqual(created.status_code,200,created.text)
            creds=created.json()
            header={'Authorization':'Bearer '+creds['token']}
            invalid=client.post('/api/v1/push/subscribe',headers=header,json={
                'subscription':{'endpoint':'https://example.com/fake',
                                'keys':{'auth':'a','p256dh':'b'}}})
            self.assertEqual(invalid.status_code,422,invalid.text)
            valid=client.post('/api/v1/push/subscribe',headers=header,json={
                'subscription':{'endpoint':'https://web.push.apple.com/mock-test',
                                'keys':{'auth':'test-auth','p256dh':'test-p256dh'}}})
            self.assertEqual(valid.status_code,200,valid.text)
            status=client.get('/api/v1/push/status',headers=header)
            self.assertTrue(status.json()['subscribed'])
            scheduled=client.post('/api/v1/push/test',headers=header)
            self.assertEqual(scheduled.status_code,200,scheduled.text)
            self.assertEqual(scheduled.json()['delay_seconds'],15)
            with read_db() as db:
                row=db.execute('SELECT id,push_json FROM devices WHERE id=?',
                               (creds['device_id'],)).fetchone()
            # Dispatch sends directly from the server; it never depends on a foreground browser.
            with patch.dict(os.environ,{'AT_VAPID_SUBJECT':'mailto:ci@example.invalid'}), patch('pywebpush.webpush') as fake_sender:
                result=asyncio.run(_send_push(row,{
                    'id':'test-sent-from-nas','title':'Test NAS','message':'PWA fermée'}))
                self.assertTrue(result['sent'],result)
                fake_sender.assert_called_once()
            history=client.get('/api/v1/push/status',headers=header).json()
            self.assertIsNotNone(history['last_success'])
            self.assertIsNone(history['last_error'])

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
