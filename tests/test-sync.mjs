import test from 'node:test';
import assert from 'node:assert/strict';
import { stableData } from '../js/sync-client.js';

test('stable snapshot removes volatile quotes but retains portfolio rules and cash',()=>{
 const obj={schemaVersion:2,owners:[{id:'damien',name:'Damien'}],portfolios:[{id:'p',name:'PEA',currentCash:10,positions:[{
  id:'2crsi',ticker:'2CRSI.PA',qty:170,pru:28.659,stopLevel:26,
  currentPrice:30.9,lastUpdate:'2026-10-26',history:{closes:[1,2]},lastQuoteStatus:'ok'}]}]};
 const result=stableData(obj);
 assert.equal(result.portfolios[0].positions[0].stopLevel,26);
 assert.equal(result.portfolios[0].positions[0].currentPrice,undefined);
 assert.equal(result.portfolios[0].positions[0].history,undefined);
 assert.equal(result.portfolios[0].currentCash,10);
});
