/** Shared news relevance classifier; same lexicon and decisions as worker/app/news.py. */
import { getMonitorRules } from './monitor-rules.js';
import { getPortfolios,getSettings,readJSON,writeJSON,state } from './store.js';
import { fetchMacroFeeds } from './data.js';
import { NotifService } from './notifications.js';
import { SyncClient } from './sync-client.js';

const seenKey='alphaTerm_localNewsSeenV1';
const checkKey='alphaTerm_localNewsCheckedAtV1';
const words=value=>String(value||'').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const exact=(text,phrase)=>{const word=words(phrase);return word.length>=3&&(' '+text+' ').includes(' '+word+' ');};
const etf=position=>/\b(etf|msci|ucits|trackers)\b/.test(words(position.name+' '+position.assetClass));

export function scoreArticle(article,positions){
  const lexicon=getMonitorRules().news_lexicon;
  const title=words(article.title),snippet=words(article.summary),all=title+' '+snippet;
  const themes=new Set(Object.entries(lexicon.topics)
    .filter(([,variants])=>variants.some(word=>exact(all,word))).map(([name])=>name));
  const material=lexicon.high.some(x=>exact(all,x));
  const moderate=lexicon.medium.some(x=>exact(all,x));
  const matches=[];
  for(const pos of positions){
    const name=words(pos.name), aliases=[];
    if(name.length>=7&&name.split(' ').length<=7)aliases.push(name);
    if(pos.isin?.length===12)aliases.push(pos.isin);
    const ticker=String(pos.yahooTicker||pos.ticker||'').split('.')[0].toUpperCase();
    if(ticker.length>=4&&ticker.length<=10&&/^[A-Z0-9]+$/.test(ticker)&&
       !['WORLD','ACTION','ACTIONS','EUROPE','NASDAQ'].includes(ticker))aliases.push(ticker);
    const direct=aliases.some(alias=>exact(all,alias));
    const sector=words(pos.sector);
    const exposed=(lexicon.sector_map[sector]||[]).some(theme=>themes.has(theme));
    if(direct||(exposed&&etf(pos)))matches.push({
      ticker:pos.ticker||'',reason:direct?'entreprise citée':'exposition ETF '+sector,direct
    });
  }
  const direct=matches.some(m=>m.direct);
  return {
    relevance:direct?3:matches.length?2:0,
    importance:matches.length?(material?3:moderate?2:1):0,
    themes:[...themes].sort(),matches,
    level:direct&&material?'critical':matches.length&&(moderate||material)?'important':'info'
  };
}

export async function evaluateLocalNews(){
  if(SyncClient.isNasActive()||!getSettings().alertNewsEnabled)return 0;
  const now=Date.now(),min=getMonitorRules().news_min_minutes*60*1000;
  if(now-Number(localStorage.getItem(checkKey)||0)<min)return 0;
  // Mark the attempt before fetching to prevent concurrent periodic requests.
  localStorage.setItem(checkKey,String(now));
  const feeds=await fetchMacroFeeds(getSettings().macroQuery,getSettings());
  const items=feeds.flatMap(feed=>feed.events||[]).filter(a=>a.url?.startsWith('https://'));
  const existing=readJSON(seenKey,null),initialized=Boolean(existing);
  const seen=new Set(Array.isArray(existing)?existing:[]);
  const portfolios=getPortfolios();
  const positions=portfolios.flatMap(p=>p.positions||[]);
  let sent=0;
  for(const item of items){
    const url=item.url.split('#')[0];
    if(seen.has(url))continue;
    seen.add(url);
    if(!initialized||state.alerts.some(a=>a.url===url))continue;
    const scored=scoreArticle(item,positions);
    if(scored.level==='info')continue;
    NotifService.push(item.title, (item.source||'Actualité')+' · '+scored.matches[0].reason,
      scored.level==='critical'?'error':'warning',{type:'news',url});
    sent++;
  }
  writeJSON(seenKey,[...seen].slice(-2000));
  return sent;
}
