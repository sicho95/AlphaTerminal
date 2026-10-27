/** Unique app-facing monitoring interface: same profile settings and rule contract in both modes. */
import { getSettings,saveSettings,getData } from './store.js';
import { refreshQuotes,fetchMacroFeeds } from './data.js';
import { evaluateMarketAlerts } from './market-alerts.js';
import { SyncClient } from './sync-client.js';
import { evaluateLocalNews } from './news-alerts.js';
import { getMonitorRules } from './monitor-rules.js';

export const MonitorService={
  get mode(){return SyncClient.isNasActive()?'nas':'local';},
  get rules(){return getMonitorRules();},
  async refresh(){
    if(this.mode==='nas'){
      const result=await SyncClient.refreshMonitor();
      saveSettings({lastQuotesRefreshAt:new Date().toISOString()});
      return {...result,source:'nas'};
    }
    const result=await refreshQuotes();
    if(result.refreshStats?.updated)evaluateMarketAlerts();
    evaluateLocalNews().catch(error=>console.warn('Local news check deferred',error));
    return {...result,source:'local'};
  },
  async news(){
    const feeds=await fetchMacroFeeds(getSettings().macroQuery,getSettings());
    return {mode:this.mode,feeds,source:this.mode==='nas'?'NAS API':'PWA locale'};
  },
  async state(){
    if(this.mode==='nas')return SyncClient.monitorState();
    return {mode:'local',contract_version:this.rules.contract_version,
      rule_version:this.rules.rule_version,quotes:getData().portfolios.flatMap(
        p=>p.positions.map(pos=>({position_key:p.id+':'+pos.id,price:pos.currentPrice,
          as_of:pos.lastUpdate,closes:pos.history?.closes||[],
          atr14:pos.atr14,suggested_stop:pos.suggestedStop}))),
      sources:this.rules.source_names,requested_refresh_minutes:getSettings().autoRefreshMinutes,
      dynamic_enabled:false};
  }
};
