import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreArticle} from '../js/news-alerts.js';

test('local and NAS news relevance fixtures agree: 2CRSI direct profit warning',()=>{
 const positions=[{ticker:'2CRSI',name:'2CRSI',sector:'Tech',assetClass:'Actions'}];
 assert.equal(scoreArticle({title:'2CRSI publie un profit warning',summary:''},positions).level,'critical');
 assert.equal(scoreArticle({title:'Pluie en Normandie'},positions).level,'info');
});
test('MSCI World ETF receives major BCE macro alerts, unrelated share does not',()=>{
 const positions=[{name:'Amundi MSCI World UCITS ETF',ticker:'CW8.PA',sector:'World'}];
 assert.equal(scoreArticle({title:'La BCE relève les taux directeurs'},positions).level,'important');
 assert.equal(scoreArticle({title:'2CRSI : petite annonce'},positions).level,'info');
});
