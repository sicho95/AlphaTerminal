/** Validate embedded page-module syntax and notebook tab-to-panel wiring in CI. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

for(const page of ['dashboard','analyse','signaux','inventaire','parametres']){
  const html=readFileSync(new URL('../pages/'+page+'.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)];
  for(const [,script] of scripts){
    const check=spawnSync('node',['--input-type=module','--check'],{input:script,encoding:'utf8'});
    assert.equal(check.status,0,'Embedded JavaScript syntax '+page+': '+check.stderr);
  }
  if(page==='dashboard')continue;
  const tabs=[...html.matchAll(/role="tab"[^>]*data-tab="([^"]+)"/g)].map(x=>x[1]);
  const panels=[...html.matchAll(/data-tab-panel="([^"]+)"/g)].map(x=>x[1]);
  assert.ok(tabs.length>0,'Missing tabs in '+page);
  assert.deepEqual(tabs,panels,'One matching panel per tab in '+page);
  assert.equal(new Set(tabs).size,tabs.length,'Duplicate tab name in '+page);
  console.log(page+': '+tabs.length+' intercalaires et scripts valides');
}
