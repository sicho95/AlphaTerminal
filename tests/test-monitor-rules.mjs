import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { FALLBACK_RULES,getMonitorRules } from '../js/monitor-rules.js';
const manifest=JSON.parse(readFileSync(new URL('../shared/monitor-rules.json',import.meta.url),'utf8'));

test('offline PWA rules match the identical manifest shipped into the Docker worker',()=>{
  assert.deepEqual(FALLBACK_RULES,manifest);
  assert.deepEqual(getMonitorRules(),manifest);
  assert.equal(manifest.quotes_min_minutes,5);
  assert.equal(manifest.news_min_minutes,15);
  assert.equal(manifest.contract_version,2);
});
test('all critical rule cutoffs have valid bounds',()=>{
  assert.ok(manifest.rsi_low<manifest.rsi_high);
  assert.ok(manifest.performance_percent>0);
  assert.ok(manifest.near_stop_percent>0);
  assert.ok(manifest.atr_period>0);
  assert.ok(manifest.quotes_max_minutes>=manifest.quotes_min_minutes);
});
