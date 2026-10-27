/** NAS Sync 1.1: opt-in. Local storage is always writable; no data leaves the PWA before pairing. */
import { exportBackup, getData, getSettings, saveSettings, saveData, addAlert, state } from './store.js';

const SESSION='alphaTerm_workerSession';
const PENDING='alphaTerm_syncPending';
const REVS='alphaTerm_syncRevisions';
const EXCLUDE=new Set(['marketauxApiKey','finnhubApiKey','twelveDataApiKey','lastQuotesRefreshAt','workerUrl','workerToken']);
const QUOTE_FIELDS=new Set(['currentPrice','history','lastUpdate','lastQuoteSource','lastQuoteSymbol','lastQuoteStatus','lastQuoteError','suggestedStop','atr14']);
const getJson=(key,fallback)=>{try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch {return fallback;}};
const putJson=(key,obj)=>localStorage.setItem(key,JSON.stringify(obj));
const cleanSettings=(settings)=>Object.fromEntries(Object.entries(settings||{}).filter(([key])=>!EXCLUDE.has(key)));
export const stableData=(data)=>({schemaVersion:data.schemaVersion||2,
  owners:data.owners||[], portfolios:(data.portfolios||[]).map(p=>({...p,positions:(p.positions||[]).map(pos=>Object.fromEntries(
    Object.entries(pos).filter(([key])=>!QUOTE_FIELDS.has(key))))}))});
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export const SyncClient={
  applying:false,working:false,enrolling:false,timer:null,ready:false,session:null,monitorCache:null,monitorAt:0,revs:{settings_rev:0,data_rev:0},
  pending:{},lastStable:null,status:'Mode local',listeners:new Set(),
  onChange(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);},
  report(message){this.status=message;this.listeners.forEach(fn=>fn(message));},
  async request(path,{method='GET',body,publicRequest=false}={}){
    const url=this.session?.url;
    if(!url)throw Error('URL du NAS manquante');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
    try {
      const resp=await fetch(`${url}/api/v1/${path}`,{method,headers:{'Content-Type':'application/json',
        ...(!publicRequest&&this.session.token?{'Authorization':`Bearer ${this.session.token}`}:{})},
        ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store'});
      const result=await resp.json().catch(()=>({}));
      if(!resp.ok){const error=new Error(typeof result.detail==='string'?result.detail:JSON.stringify(result.detail||result));error.status=resp.status;throw error;}
      return result;
    } finally {clearTimeout(timeout);}
  },
  async init(){
    this.session=getJson(SESSION,null);this.revs=getJson(REVS,{settings_rev:0,data_rev:0});
    this.pending=getJson(PENDING,{});
    this.lastStable=stableData(getData());
    this.ready=true;
    document.addEventListener('alphaterminal:storechange',event=>this.onLocalChange(event.detail));
    if(this.session?.token){this.report('Profil NAS associé · synchronisation en cours');this.schedule(300);this.enrollPushIfGranted().catch(e=>this.report('Web Push à vérifier : '+e.message));}
    window.addEventListener('online',()=>this.schedule(400));
    window.addEventListener('focus',()=>this.schedule(400));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.schedule(400);});
    setInterval(()=>{if(!document.hidden)this.schedule(150)},60000);
  },
  onLocalChange(change){
    if(!this.ready||this.applying||!this.session?.token)return;
    if(change.kind==='settings'){
      const patch=cleanSettings(change.patch);
      if(Object.keys(patch).length)this.pending.settings_patch={...(this.pending.settings_patch||{}),...patch};
    }
    if(change.kind==='data'){
      const stable=stableData(getData());
      if(!eq(stable,this.lastStable)){
        this.pending.data=stable;this.lastStable=stable;
      }
    }
    putJson(PENDING,this.pending);
    this.schedule(350);
  },
  schedule(ms=500){clearTimeout(this.timer);if(this.session?.token)this.timer=setTimeout(()=>this.flush(),ms);},
  async flush(){
    if(this.working||!this.session?.token||!navigator.onLine)return;
    this.working=true;
    try{
      const outbound=JSON.parse(JSON.stringify(this.pending));
      if(Object.keys(outbound).length){
        const changes={};
        if(outbound.settings_patch){changes.settings_patch=outbound.settings_patch;changes.settings_base_rev=this.revs.settings_rev;}
        if(outbound.data){changes.data=outbound.data;changes.data_base_rev=this.revs.data_rev;}
        const next=await this.request('sync/changes',{method:'POST',body:changes});
        this.revs={settings_rev:next.settings_rev,data_rev:next.data_rev};putJson(REVS,this.revs);
        // Keep edits that happened while the request was in flight.
        for(const kind of ['settings_patch','data']){
          if(outbound[kind] && eq(outbound[kind],this.pending[kind]))delete this.pending[kind];
        }
        putJson(PENDING,this.pending);
        this.report('Modifications sauvegardées sur le NAS');
      }
      if(!Object.keys(this.pending).length){
        const remote=await this.request('sync/state');
        await this.applyRemote(remote);
        await this.syncAlerts();
        if(this.isNasActive())await this.refreshMonitor();
      }
    }catch(error){
      if(error.status===409)this.report(`Conflit de synchronisation : ${error.message}. Choisir une version dans Paramètres.`);
      else this.report(`Synchronisation différée : ${error.message}`);
    }finally{this.working=false;if(Object.keys(this.pending).length&&!this.status.startsWith('Conflit'))this.schedule(15000);}
  },
  async applyRemote(remote){
    if(Object.keys(this.pending).length)return;
    this.applying=true;
    try{
      if(remote.settings_rev>this.revs.settings_rev){
        saveSettings(cleanSettings(remote.settings));
      }
      if(remote.data_rev>this.revs.data_rev){
        const existing=new Map((getData().portfolios||[]).flatMap(p=>(p.positions||[]).map(pos=>[`${p.id}:${pos.id}`,pos])));
        const next={...remote.data,portfolios:(remote.data.portfolios||[]).map(p=>({...p,
          positions:(p.positions||[]).map(pos=>{
            const old=existing.get(`${p.id}:${pos.id}`);
            return old?{...pos,...Object.fromEntries(Object.entries(old).filter(([k])=>QUOTE_FIELDS.has(k)))}:pos;
          })}))};
        saveData(next);
        this.lastStable=stableData(getData());
      }
      this.revs={settings_rev:remote.settings_rev,data_rev:remote.data_rev};putJson(REVS,this.revs);
      this.report('Profil synchronisé');
    }finally{this.applying=false;}
  },
  async syncAlerts(){
    const result=await this.request('alerts');
    for(const alert of result.alerts||[])if(!state.alerts.some(a=>a.id===alert.id))addAlert(alert);
  },
  setUrl(url){
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname))throw Error('HTTPS obligatoire pour le NAS');
    if(parsed.username||parsed.password||parsed.search||parsed.hash)throw Error('URL serveur non valide');
    this.session={url:parsed.origin+(parsed.pathname==='/'?'':parsed.pathname.replace(/\/$/,''))};
  },
  async newProfile(url,profileName,deviceName){
    if(this.enrolling)throw Error('Création du profil déjà en cours');
    if(this.session?.token)throw Error('Ce navigateur possède déjà un profil NAS. Utiliser la restauration ou un autre appareil.');
    this.enrolling=true;
    try {
    this.setUrl(url);
    const creds=await this.request('profiles/create',{method:'POST',body:{profile_name:profileName,device_name:deviceName},publicRequest:true});
    this.session={...this.session,...creds};putJson(SESSION,this.session);
    localStorage.setItem('alphaTerm_deviceName',deviceName);
    this.revs={settings_rev:0,data_rev:0};putJson(REVS,this.revs);
    this.pending={settings_patch:cleanSettings(getSettings()),data:stableData(getData())};putJson(PENDING,this.pending);
    await this.flush();this.enrollPushIfGranted().catch(()=>{});return creds;
    } finally {this.enrolling=false;}
  },
  async ensureRecovery(){
    if(!this.session?.token)return null;
    if(!this.session.recovery_secret){
      const response=await this.request('profiles/recovery');
      this.session={...this.session,...response};putJson(SESSION,this.session);
    }
    return {url:this.session.url,profile_id:this.session.profile_id,recovery_secret:this.session.recovery_secret,profile_name:this.session.profile_name};
  },
  async restoreConnection(nas,deviceName,source='auto',backupMeta=null){
    if(!nas?.url||!nas.profile_id||!nas.recovery_secret)throw Error('Sauvegarde sans preuve de récupération NAS valide');
    const previous=this.session;
    this.setUrl(nas.url);
    try {
      const sameDevice=previous?.profile_id===nas.profile_id&&previous?.token&&previous?.url===this.session.url;
      let remote=null;
      if(sameDevice){
        this.session=previous;
        try{remote=await this.request('sync/state');}
        catch(error){
          if(error.status!==401)throw error; // ancien jeton révoqué : demander une nouvelle identité technique
        }
      }
      if(!remote){
        const creds=await this.request('profiles/recover',{method:'POST',
          body:{profile_id:nas.profile_id,recovery_secret:nas.recovery_secret,device_name:deviceName},publicRequest:true});
        this.session={url:nas.url,...creds,recovery_secret:nas.recovery_secret};
        remote=await this.request('sync/state');
      }
      putJson(SESSION,this.session);
      localStorage.setItem('alphaTerm_deviceName',deviceName);
      this.pending={};putJson(PENDING,this.pending);
      this.revs={settings_rev:0,data_rev:0};putJson(REVS,this.revs);
      const revisions=backupMeta?.revisions;
      const backedRevsKnown=Number.isInteger(revisions?.data_rev)&&Number.isInteger(revisions?.settings_rev);
      const remoteIsNewer=backedRevsKnown?(
        remote.data_rev>revisions.data_rev||remote.settings_rev>revisions.settings_rev):null;
      const backedUpData=stableData(getData());
      const differentData=!eq(backedUpData,stableData(remote.data||{owners:[],portfolios:[]}));
      const differentSettings=!eq(cleanSettings(getSettings()),cleanSettings(remote.settings||{}));
      const changed=differentData||differentSettings;
      let useBackup=!remoteIsNewer;
      if(remoteIsNewer===true&&changed){
        useBackup=!confirm('Le NAS a des modifications plus récentes que cette sauvegarde. OK : conserver les données NAS actuelles. Annuler : remplacer le NAS par les données du JSON.');
      }else if(remoteIsNewer===null&&changed&&(remote.data_rev||remote.settings_rev)){
        useBackup=!confirm('Impossible de comparer les dates de cet ancien JSON avec le NAS. OK : garder la version NAS. Annuler : remplacer par le JSON.');
      }else if(!changed){
        useBackup=false; // pas de modification à transmettre
      }
      if(useBackup){
        this.revs={settings_rev:remote.settings_rev,data_rev:remote.data_rev};putJson(REVS,this.revs);
        this.pending={settings_patch:cleanSettings(getSettings()),data:backedUpData};putJson(PENDING,this.pending);
        await this.flush();
        if(Object.keys(this.pending).length)throw Error('Synchronisation NAS différée : vérifier le statut');
      }else{
        await this.applyRemote(remote);
      }
      this.lastStable=stableData(getData());
      this.enrollPushIfGranted().catch(()=>{});
      this.report('Profil NAS existant restauré · suivi autonome conservé');
      return remote;
    }catch(error){
      // Rétablir la connexion précédente si le NAS de la sauvegarde n'a pas pu être rejoint.
      this.session=previous;
      if(previous)putJson(SESSION,previous);
      else localStorage.removeItem(SESSION);
      throw error;
    }
  },
  async createPairCode(){
    if(!this.session?.token)throw Error('Cet appareil doit déjà être relié au profil NAS');
    return this.request('pair/invite',{method:'POST'});
  },
  async joinPair(url,code,deviceName){
    if(this.session?.token)throw Error('Cet appareil possède déjà une connexion NAS');
    const current=this.session;
    this.setUrl(url);
    let creds;
    try{
      creds=await this.request('pair/join',{method:'POST',publicRequest:true,
        body:{code,device_name:deviceName}});
    }catch(error){this.session=current;throw error;}
    this.session={...this.session,...creds};
    putJson(SESSION,this.session);
    localStorage.setItem('alphaTerm_deviceName',deviceName);
    this.revs={settings_rev:0,data_rev:0};this.pending={};
    putJson(REVS,this.revs);putJson(PENDING,this.pending);
    const remote=await this.request('sync/state');
    await this.applyRemote(remote);
    await this.syncAlerts();
    if(this.isNasActive())await this.refreshMonitor();
    this.enrollPushIfGranted().catch(()=>{});
    return creds;
  },
  isNasActive(){return Boolean(this.session?.token&&getSettings().dynamicEnabled);},
  async monitorState(force=false){
    if(!this.isNasActive())return null;
    if(!force&&this.monitorCache&&Date.now()-this.monitorAt<45000)return this.monitorCache;
    const remote=await this.request('monitor/state');
    if(remote.contract_version!==2)throw Error('Contrat de surveillance NAS non compatible');
    this.monitorCache=remote;this.monitorAt=Date.now();
    return remote;
  },
  async refreshMonitor(){
    if(!this.isNasActive())return {refreshStats:{updated:0,failed:0,total:0,failures:[]}};
    const remote=await this.monitorState(true);
    // NAS is source of truth for live prices when dynamic surveillance is enabled.
    const quotes=new Map((remote.quotes||[]).map(q=>[q.position_key,q]));
    const original=getData();
    let updated=0;
    const portfolios=(original.portfolios||[]).map(p=>({...p,positions:(p.positions||[]).map(pos=>{
      const key=p.id+':'+(pos.id||pos.isin||pos.ticker);
      const quote=quotes.get(key);
      if(!quote||!Number.isFinite(quote.price)||quote.price<=0)return pos;
      const old=Date.parse(pos.lastUpdate||'')||0;
      const next=Date.parse(quote.updated_at)||0;
      if(next<=old&&pos.currentPrice===quote.price)return pos;
      updated++;
      return {...pos,currentPrice:quote.price,
        atr14:quote.atr14,suggestedStop:quote.suggested_stop,
        history:{...(pos.history||{}),closes:quote.closes||[],highs:quote.highs||[],lows:quote.lows||[]},
        lastUpdate:quote.updated_at,lastQuoteSource:'Yahoo Finance · NAS',
        lastQuoteSymbol:quote.symbol,lastQuoteStatus:'ok',lastQuoteError:''};
    })}));
    if(updated){
      const before=this.applying;this.applying=true;
      try{saveData({...original,portfolios});}finally{this.applying=before;}
      this.lastStable=stableData(getData());
    }
    for(const alert of remote.alerts||[])
      if(!state.alerts.some(existing=>existing.id===alert.id))addAlert(alert);
    return {refreshStats:{updated,failed:0,total:quotes.size,failures:[]}};
  },
  async pushStatus(){
    if(!this.session?.token)return null;
    return this.request('push/status');
  },
  async testPush(){
    if(!this.session?.token)throw Error('Profil NAS non associé');
    return this.request('push/test',{method:'POST'});
  },
  async enrollPushIfGranted(){
    if(this.session?.token&&getSettings().dynamicEnabled&&
       'Notification' in globalThis&&Notification.permission==='granted'){
      return this.enablePush(false);
    }
    return null;
  },
  async startPair(url,deviceName){
    this.setUrl(url);
    const pending=await this.request('pair/start',{method:'POST',body:{device_name:deviceName},publicRequest:true});
    sessionStorage.setItem('alphaTerm_pairPending',JSON.stringify({url:this.session.url,...pending}));
    return pending;
  },
  async approve(code){return this.request('pair/approve',{method:'POST',body:{code}});},
  async claim(){
    const pair=JSON.parse(sessionStorage.getItem('alphaTerm_pairPending')||'null');
    if(!pair)throw Error('Aucun appairage en attente');
    this.session={url:pair.url};
    if(getData().portfolios?.length && !confirm('Ce téléphone possède déjà des portefeuilles. As-tu exporté une sauvegarde JSON et veux-tu restaurer le profil NAS à la place ?')){
      return {status:'declined'};
    }
    const result=await this.request('pair/claim',{method:'POST',publicRequest:true,
      body:{request_id:pair.request_id,claim_secret:pair.claim_secret}});
    if(result.status!=='ready')return result;
    this.session={url:pair.url,...result};putJson(SESSION,this.session);
    localStorage.setItem('alphaTerm_deviceName',pair.device_name||'Nouvel appareil');
    this.revs={settings_rev:0,data_rev:0};this.pending={};putJson(REVS,this.revs);putJson(PENDING,{});
    sessionStorage.removeItem('alphaTerm_pairPending');
    await this.flush();this.enrollPushIfGranted().catch(()=>{});return result;
  },
  async resolve(useLocal){
    const server=await this.request('sync/state');
    if(useLocal){
      if(!confirm('Forcer les modifications locales sur le NAS ? Cela remplacera la version distante des champs concernés.'))return;
      this.revs={settings_rev:server.settings_rev,data_rev:server.data_rev};putJson(REVS,this.revs);
      await this.flush();
    }else{
      if(!confirm('Abandonner les modifications locales non synchronisées et restaurer celles du NAS ?'))return;
      this.pending={};putJson(PENDING,{});
      this.revs={settings_rev:0,data_rev:0};putJson(REVS,this.revs);
      await this.applyRemote(server);
    }
  },
  async enablePush(askPermission=false){
    if(!this.session?.token)throw Error('Associer le NAS avant les Web Push');
    if(!('serviceWorker' in navigator)||!('PushManager' in globalThis))throw Error('Web Push non disponible sur cet appareil');
    if(!('Notification' in globalThis))throw Error('Notifications indisponibles');
    if(Notification.permission!=='granted'){
      if(!askPermission)return {status:'permission-required'};
      const perm=await Notification.requestPermission();
      if(perm!=='granted')throw Error('Notifications refusées dans les réglages iOS');
    }
    const {publicKey}=await this.request('push/key');
    const padded=publicKey+'='.repeat((4-publicKey.length%4)%4);
    const binary=Uint8Array.from(atob(padded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const registration=await navigator.serviceWorker.ready;
    let sub=await registration.pushManager.getSubscription();
    if(!sub)sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:binary});
    const result=await this.request('push/subscribe',{method:'POST',body:{subscription:sub.toJSON()}});
    return result;
  }
};
