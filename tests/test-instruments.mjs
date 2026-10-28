import test from 'node:test';
import assert from 'node:assert/strict';
import {groupInstruments,instrumentKey} from '../js/instruments.js';
import {eligibleHoldings,latestByInstrument} from '../js/holding-news.js';
import {normalizeSuggestions} from '../js/instrument-search.js';

const positions=[
  {id:'p1',ticker:'SAN.PA',yahooTicker:'SAN.PA',isin:'FR0000120578',name:'Sanofi',qty:5,pru:70,currentPrice:95,portfolioId:'pea'},
  {id:'p2',ticker:'SAN.PA',yahooTicker:'SAN.PA',isin:'FR0000120578',name:'SANOFI SA',qty:3,pru:80,currentPrice:95,portfolioId:'cto'},
  {id:'p3',ticker:'SAN.PA',yahooTicker:'SAN.PA',name:'Sanofi',qty:2,pru:90,currentPrice:95,portfolioId:'third'},
  {id:'p4',ticker:'ACA.PA',isin:'FR0000045072',name:'Crédit Agricole',qty:10,pru:15,currentPrice:16,portfolioId:'pea'}
];
test('same ISIN/ticker across PEA/CTO is one instrument but three accounting positions',()=>{
  const groups=groupInstruments(positions);
  assert.equal(groups.length,2);
  const san=groups.find(g=>g.key==='isin:FR0000120578');
  assert.ok(san);
  assert.equal(san.positions.length,3);
  assert.equal(san.accountCount,3);
  assert.equal(san.totalQty,10);
  assert.equal(san.totalValue,950);
  assert.equal(positions.length,4);
  assert.equal(instrumentKey(positions[0]),instrumentKey(positions[1]));
  assert.equal(eligibleHoldings(positions).length,2);
  assert.equal(eligibleHoldings(positions)[0].instrumentKey,'isin:FR0000120578');
});
test('market instruments with distinct tickers remain separate',()=>{
  assert.equal(groupInstruments([positions[0],positions[3]]).length,2);
});
test('latest four financial articles per holding, no duplicate URL for same security',()=>{
  const first='isin:FR0000120578';
  const news=Array.from({length:7},(_,n)=>({
    position_id:first,url:'https://example.org/article-'+n,published_at:new Date(Date.UTC(2026,9,28,10,n)).toISOString()
  }));
  news.push({...news[0]});
  news.push({position_id:'isin:FR0000045072',url:'https://example.org/other',
    published_at:'2026-10-28T11:00:00Z'});
  const recent=latestByInstrument(news);
  assert.equal(recent.filter(a=>a.position_id===first).length,4);
  assert.equal(recent.filter(a=>a.position_id!==first).length,1);
  assert.equal(recent[0].url,'https://example.org/article-6');
});
test('Yahoo suggestions sanitize duplicates and unsupported results',()=>{
  const result=normalizeSuggestions([
    {symbol:'san.pa',longname:'Sanofi',quoteType:'EQUITY',exchange:'PAR'},
    {symbol:'SAN.PA',longname:'duplicate',quoteType:'EQUITY'},
    {symbol:'BAD<script>',longname:'Bad',quoteType:'EQUITY'},
    {symbol:'CW8.PA',shortname:'Amundi MSCI World',quoteType:'ETF'}
  ]);
  assert.deepEqual(result.map(x=>x.symbol),['SAN.PA','CW8.PA']);
});
