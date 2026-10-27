import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleHoldings,holdingNews} from '../js/holding-news.js';

test('only owned financial securities, not cash or sold lines, sorted by value',()=>{
 const holdings=eligibleHoldings([
  {id:'a',name:'Example',ticker:'EXMP.PA',qty:3,currentPrice:10},
  {id:'b',name:'Cash',ticker:'CASH',qty:1,assetClass:'Liquidités'},
  {id:'c',name:'Sold',ticker:'SOLD.PA',qty:0,currentPrice:1000},
  {id:'d',name:'Second',ticker:'SCND.PA',qty:2,currentPrice:100}
 ]);
 assert.deepEqual(holdings.map(x=>x.id),['d','a']);
});
test('period parameter validated before any external request',async()=>{
 await assert.rejects(()=>holdingNews([],[],{days:45}),/Période non prise en charge/);
 const empty=await holdingNews([],[],{days:7});
 assert.equal(empty.total_positions,0);
 assert.deepEqual(empty.articles,[]);
 assert.equal(empty.next_offset,null);
});
