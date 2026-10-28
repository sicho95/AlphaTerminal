/** Identity of a traded instrument, separate from each holding/account position ID.
 * One security can be held in multiple accounts without merging their tax/account records.
 */
const value=v=>String(v??'').trim();
export const validIsin=v=>/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value(v).toUpperCase());
export const cleanSymbol=v=>value(v).toUpperCase().replace(/\s+/g,'');
export function instrumentAliases(position){
  const isin=cleanSymbol(position.isin);
  const yahoo=cleanSymbol(position.yahooTicker);
  const ticker=cleanSymbol(position.ticker);
  const result=[];
  if(validIsin(isin))result.push('isin:'+isin);
  if(yahoo)result.push('symbol:'+yahoo);
  if(ticker&&ticker!==yahoo)result.push('symbol:'+ticker);
  return result;
}
export function instrumentKey(position){
  const aliases=instrumentAliases(position);
  return aliases.find(k=>k.startsWith('isin:'))||
    aliases.find(k=>k.startsWith('symbol:'))||
    'position:'+value(position.id||position.name).toUpperCase();
}
export function groupInstruments(positions){
  const groups=[];
  // Merge accounts through shared ISIN or exchange-qualified Yahoo symbol.
  for(const pos of positions){
    const aliases=instrumentAliases(pos);
    const explicitIsin=aliases.find(a=>a.startsWith('isin:'));
    const matches=groups.filter(g=>{
      const existingIsin=[...g.aliases].find(a=>a.startsWith('isin:'));
      if(explicitIsin&&existingIsin&&explicitIsin!==existingIsin)return false;
      return aliases.some(a=>g.aliases.has(a));
    });
    if(!matches.length){
      groups.push({positions:[pos],aliases:new Set(aliases)});
    }else{
      const primary=matches[0];
      primary.positions.push(pos);
      aliases.forEach(a=>primary.aliases.add(a));
      for(const duplicate of matches.slice(1)){
        primary.positions.push(...duplicate.positions);
        duplicate.aliases.forEach(a=>primary.aliases.add(a));
        groups.splice(groups.indexOf(duplicate),1);
      }
    }
  }
  return groups.map(group=>{
    const holdings=group.positions;
    const representative=holdings.find(p=>validIsin(p.isin))||holdings[0];
    const key=[...group.aliases].find(k=>k.startsWith('isin:'))||
      [...group.aliases].find(k=>k.startsWith('symbol:'))||instrumentKey(representative);
    return {
      key,
      representative:{...representative,instrumentKey:key},
      positions:holdings,
      accountCount:new Set(holdings.map(p=>p.portfolioId||p.accountId)).size,
      totalQty:holdings.reduce((n,p)=>n+Number(p.qty||0),0),
      totalValue:holdings.reduce((n,p)=>n+Number(p.qty||0)*Number(p.currentPrice||0),0)
    };
  }).sort((a,b)=>b.totalValue-a.totalValue);
}
