import assert from 'node:assert/strict';
import { test } from 'node:test';
const map = new Map();
globalThis.localStorage = {
 getItem(key) { return map.has(key) ? map.get(key) : null; },
 setItem(key, val) { map.set(key, String(val)); },
 removeItem(key) { map.delete(key); }
};
globalThis.window = { dispatchEvent() {} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: undefined } });
globalThis.Notification = { permission: 'denied' };
const store=await import('../js/store.js');
const engine=await import('../js/market-alerts.js');
const seed={schemaVersion:2,owners:[{id:'test',name:'Demo'}],portfolios:[{id:'pea-1',ownerId:'test',type:'PEA',name:'PEA de test',positions:[{id:'p1',ticker:'TEST.PA',name:'Valeur fictive',qty:1,pru:10,currentPrice:10,stopLevel:9,lastQuoteStatus:'ok',lastUpdate:new Date().toISOString(),history:{closes:Array.from({length:30}, (_,i)=>10+i*0.1)}}]}]};
map.set('alphaTerm_data',JSON.stringify(seed));
map.set('alphaTerm_settings',JSON.stringify({autoRefreshMinutes:10,macroProvider:'oksurf',corsProxy:'https://proxy.sicho.workers.dev/?url='}));
store.initStore({schemaVersion:2,owners:[],portfolios:[]});
const setPrice=(price,{status='ok',stop=9}={})=>{
 const data=store.getData();
 const p=data.portfolios[0];
 store.saveData({...data,portfolios:[{...p,positions:p.positions.map(x=>({...x,currentPrice:price,stopLevel:stop,lastQuoteStatus:status,lastUpdate:new Date().toISOString()}))}]});
};

test('existing portfolio and settings survive init and migration',()=>{
 assert.equal(store.getPortfolios()[0].id,'pea-1');
 assert.equal(store.getSettings().corsProxy,'https://proxy.sicho.workers.dev/?url=');
 assert.equal(store.getSettings().autoRefreshMinutes,10);
 assert.equal(store.APP_VERSION,'1.2.2');
 assert.equal(map.has('alphaTerm_data'),true);
});
test('stop alerts are deduplicated, rearmed only on safe transition',()=>{
 setPrice(8.5);
 assert.equal(engine.evaluateMarketAlerts(),1);
 assert.equal(engine.evaluateMarketAlerts(),0);
 assert.equal(store.state.alerts.length,1);
 setPrice(11);
 assert.equal(engine.evaluateMarketAlerts(),0);
 setPrice(8.5);
 assert.equal(engine.evaluateMarketAlerts(),1);
 assert.equal(store.state.alerts.length,2);
});
test('price source error never triggers spurious stop alert or clears state',()=>{
 setPrice(12);
 engine.evaluateMarketAlerts();
 setPrice(8.5,{status:'error'});
 assert.equal(engine.evaluateMarketAlerts(),0);
 setPrice(8.5,{status:'ok'});
 assert.equal(engine.evaluateMarketAlerts(),1);
});
test('near stop transitions do not re-notify every refresh',()=>{
 setPrice(10);
 engine.evaluateMarketAlerts();
 setPrice(9.2);
 assert.equal(engine.evaluateMarketAlerts(),1);
 assert.equal(engine.evaluateMarketAlerts(),0);
});
test('missing stop disables stop alerts',()=>{
 setPrice(12,{stop:0});
 assert.equal(engine.evaluateMarketAlerts(),0);
});
test('remote event dedupe by stable id retains local history',()=>{
 const a=store.addAlert({id:'remote-id',title:'WebPush test',message:'fictif'});
 const b=store.addAlert({id:'remote-id',title:'WebPush test',message:'fictif'});
 assert.equal(a.id,b.id);
 assert.equal(store.state.alerts.filter(x=>x.id==='remote-id').length,1);
});
test('performance and RSI notifications are opt-in only',()=>{
 setPrice(20,{stop:0});
 assert.equal(engine.evaluateMarketAlerts(),0);
 store.saveSettings({alertPerformanceEnabled:true});
 assert.equal(engine.evaluateMarketAlerts(),1);
 assert.equal(engine.evaluateMarketAlerts(),0);
});
