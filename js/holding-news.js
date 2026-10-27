/** News sur titres réellement détenus : recherche financière spécifique, PAS macro.
 * Deux backends derrière un contrat identique : worker NAS ou fournisseurs publics locaux.
 */
import { SyncClient } from './sync-client.js';
import { getSettings } from './store.js';

const TTL=20*60*1000, PAGE=6, memory=new Map();
const symbolOk=s=>/^[A-Za-z0-9.\-^=]{2,32}$/.test(s);
const clean=s=>String(s||'').trim();
const pKey=p=>String(p.id||p.isin||p.ticker||'');
export function eligibleHoldings(positions) {
  const seen=new Set();
  return positions.filter(p=>{
    const kind=clean(p.assetClass).toLowerCase();
    const key=pKey(p);
    if(Number(p.qty)<=0||!key||seen.has(key)||/liquid|cash|crypto/.test(kind))return false;
    seen.add(key);return true;
  }).sort((a,b)=>Number(b.qty)*Number(b.currentPrice)-Number(a.qty)*Number(a.currentPrice));
}
function proxied(url){
  const proxy=getSettings().corsProxy||'https://api.allorigins.win/raw?url=';
  return proxy.includes('{url}')?proxy.replace('{url}',encodeURIComponent(url)):proxy+encodeURIComponent(url);
}
function publishedAt(value) {
  const date=typeof value==='number'?new Date(value*1000):new Date(value);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
function event(title,url,source,provider,when,holding,days){
  if(!clean(title)||!/^https:\/\//i.test(url||''))return null;
  const stamp=publishedAt(when);
  if(!stamp||Date.now()-Date.parse(stamp)>days*86400000||Date.parse(stamp)>Date.now()+86400000)return null;
  return {title:clean(title).slice(0,250),url:clean(url),source:clean(source||provider),
    provider,holding_name:holding.name,position_id:pKey(holding),
    ticker:holding.ticker,published_at:stamp};
}
function queryTerms(holding){
  const name=clean(holding.name).replace(/\b(EURONEXT PARIS|ACC|DIST)\b/gi,'').trim().slice(0,90);
  const symbol=clean(holding.yahooTicker||holding.ticker).split('.')[0];
  const company=name.length>=5?name:symbol;
  const isin=clean(holding.isin).toUpperCase();
  return {
    company, symbol,
    query:'"'+company.replaceAll('"','')+'"'+(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)?' OR "'+isin+'"':'')
  };
}
async function singleLocal(holding,days){
  const {company,symbol,query}=queryTerms(holding);
  const errors=[];
  if(!company)return {articles:[],errors:['Nom du titre insuffisant']};
  const jobs=[
    async()=>{
      const u=new URL('https://news.google.com/rss/search');
      u.search=new URLSearchParams({q:'('+query+') when:'+days+'d',hl:'fr',gl:'FR',ceid:'FR:fr'}).toString();
      const response=await fetch(proxied(u.href));
      if(!response.ok)throw Error('HTTP '+response.status);
      const xml=new DOMParser().parseFromString(await response.text(),'application/xml');
      if(xml.querySelector('parsererror'))throw Error('RSS non valide');
      return [...xml.querySelectorAll('item')].slice(0,14).map(item=>event(
        item.querySelector('title')?.textContent,item.querySelector('link')?.textContent,
        item.querySelector('source')?.textContent,'Google Actualités',
        item.querySelector('pubDate')?.textContent,holding,days)).filter(Boolean);
    },
    async()=>{
      if(!symbolOk(symbol))return [];
      const url=new URL('https://query1.finance.yahoo.com/v1/finance/search');
      url.search=new URLSearchParams({q:symbol,newsCount:'12',quotesCount:'0',lang:'fr-FR',region:'FR'}).toString();
      const response=await fetch(proxied(url.href));
      if(!response.ok)throw Error('HTTP '+response.status);
      const data=await response.json();
      return (data.news||[]).map(a=>event(a.title,a.link,a.publisher,'Yahoo Finance',
        a.providerPublishTime,holding,days)).filter(Boolean);
    },
    async()=>{
      const url=new URL('https://api.gdeltproject.org/api/v2/doc/doc');
      url.search=new URLSearchParams({query:'"'+company.replace(/["()]/g,'')+'"',
        mode:'artlist',format:'json',maxrecords:'12',timespan:days+'d'}).toString();
      const response=await fetch(proxied(url.href));
      if(!response.ok)throw Error('HTTP '+response.status);
      const data=await response.json();
      return (data.articles||[]).map(a=>{
        const raw=a.seendate;
        const when=/^\d{8}T\d{6}Z?$/.test(raw||'')?
          raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8)+'T'+raw.slice(9,11)+':'+raw.slice(11,13)+':'+raw.slice(13,15)+'Z':raw;
        return event(a.title,a.url,a.domain,'GDELT',when,holding,days);
      }).filter(Boolean);
    }
  ];
  const results=await Promise.all(jobs.map(async(fn,index)=>{
    try{return await fn()}catch(error){
      errors.push(['Google Actualités','Yahoo Finance','GDELT'][index]+' : indisponible');
      return [];
    }
  }));
  const byUrl=new Map(results.flat().map(item=>[item.url.split('#')[0],item]));
  return {articles:[...byUrl.values()].sort((a,b)=>b.published_at.localeCompare(a.published_at)).slice(0,16),errors};
}
export async function holdingNews(positions,portfolios,{days=7,positionId='',offset=0}={}){
  if(![7,30].includes(Number(days)))throw Error('Période non prise en charge');
  const eligible=eligibleHoldings(positions);
  if(SyncClient.isNasActive())return SyncClient.holdingNews(days,positionId,offset,portfolios.map(p=>p.id));
  const filtered=positionId?eligible.filter(p=>pKey(p)===positionId):eligible;
  const current=filtered.slice(offset,offset+PAGE);
  const results=[],errors=[];
  // Two holdings at a time; no mass request burst on the user's phone.
  for(let start=0;start<current.length;start+=2){
    const batch=await Promise.all(current.slice(start,start+2).map(async p=>{
      const key=JSON.stringify([pKey(p),p.name,p.ticker,p.isin,days]);
      const cached=memory.get(key);
      if(cached&&Date.now()-cached.timestamp<TTL)return cached.value;
      const value=await singleLocal(p,days);
      memory.set(key,{timestamp:Date.now(),value});return value;
    }));
    for(const data of batch){results.push(...data.articles);errors.push(...data.errors);}
  }
  const unique=new Map(results.map(a=>[a.url.split('#')[0],a]));
  return {articles:[...unique.values()].sort((a,b)=>b.published_at.localeCompare(a.published_at)).slice(0,40),
    total_positions:filtered.length,checked_positions:current.length,offset,
    next_offset:offset+current.length<filtered.length?offset+current.length:null,
    source_errors:[...new Set(errors)],sources:['Google Actualités','Yahoo Finance','GDELT']};
}
