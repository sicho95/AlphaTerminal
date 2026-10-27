/** Autonomous NAS setup with one-step pairing and automatic push enrollment. */
import { SyncClient } from './sync-client.js';
import { getData } from './store.js';

let unsubscribe=null;
export function initSyncUI(){
  const el=id=>document.getElementById(id);
  if(!el('syncServer'))return;
  if(unsubscribe)unsubscribe();
  const status=el('syncStatus');
  const show=message=>{
    status.textContent=message;
    const conflict=/^Conflit de synchronisation/.test(message);
    el('syncConflictArea')?.classList.toggle('hidden',!conflict);
  };
  const render=()=>{
    const joined=Boolean(SyncClient.session?.token);
    el('syncCreateArea')?.classList.toggle('hidden',joined);
    el('syncExistingArea')?.classList.toggle('hidden',!joined);
    el('syncNewArea')?.classList.toggle('hidden',joined);
    el('syncName').disabled=joined;
    el('syncDevice').disabled=joined;
    el('syncServer').disabled=joined;
  };
  unsubscribe=SyncClient.onChange(message=>{show(message);render();});
  el('syncServer').value=SyncClient.session?.url||el('syncServer').value||'';
  el('syncName').value=SyncClient.session?.profile_name||'';
  el('syncDevice').value=localStorage.getItem('alphaTerm_deviceName')||'';
  show(SyncClient.status);
  render();
  const run=fn=>async()=>{
    try{await fn();render();}
    catch(error){show('Erreur : '+error.message);}
  };

  el('syncCreate').onclick=run(async()=>{
    const profile=el('syncName').value.trim();
    const name=el('syncDevice').value.trim()||'Mon appareil';
    if(!profile)throw Error('Indiquer un nom de profil');
    const credentials=await SyncClient.newProfile(el('syncServer').value,profile,name);
    show('Profil '+credentials.profile_name+' créé et associé à cet appareil.');
  });

  el('syncPairInvite').onclick=run(async()=>{
    const result=await SyncClient.createPairCode();
    el('syncGeneratedCode').textContent='Code à saisir sur le NOUVEL appareil : '+result.code+' (valable 5 min, usage unique).';
  });

  el('syncPairJoin').onclick=run(async()=>{
    const code=el('syncPairCode').value.trim();
    if(!/^\d{6}$/.test(code))throw Error('Entrer le code à 6 chiffres affiché sur l’ancien appareil');
    if(getData().portfolios?.length&&!confirm('Cet appareil contient déjà des portefeuilles locaux. Le profil NAS remplacera leur affichage. Vérifie que tu disposes d’une sauvegarde avant de continuer.'))return;
    const name=el('syncDevice').value.trim()||'Mon appareil';
    await SyncClient.joinPair(el('syncServer').value,code,name);
    el('syncPairCode').value='';
    show('Appareil '+name+' relié au même profil NAS. Synchronisation active.');
  });
  el('syncNow').onclick=run(async()=>{
    await SyncClient.flush();
    await SyncClient.monitorState(true).catch(()=>null);
    show(SyncClient.status);
  });
  el('syncServerWins').onclick=run(async()=>{
    await SyncClient.resolve(false);show(SyncClient.status);
  });
  el('syncLocalWins').onclick=run(async()=>{
    await SyncClient.resolve(true);show(SyncClient.status);
  });

  const pushStatus=el('syncPushStatus');
  const refreshPush=async()=>{
    if(!pushStatus)return;
    if(!SyncClient.session?.token){
      pushStatus.textContent='Web Push NAS : nécessite un profil NAS ; mode local, notifications seulement si l’application fonctionne.';
      return;
    }
    try{
      const response=await SyncClient.pushStatus();
      const permission='Notification' in globalThis?Notification.permission:'non disponible';
      const subscribed=response.subscribed?'abonné au NAS':'pas encore abonné';
      const last=response.last_success?' · dernier envoi accepté : '+response.last_success:'';
      const issue=response.last_error?' · dernier échec : '+response.last_error:'';
      const cadence=' · cours '+Math.round(response.quotes_interval_seconds/60)+' min min., actualités '+Math.round(response.news_interval_seconds/60)+' min min.';
      pushStatus.textContent='Web Push : '+subscribed+' · autorisation '+permission+
        (response.dynamic_enabled?' · surveillance NAS active':' · surveillance NAS désactivée')+
        (response.worker_subject_configured?'':' · configuration NAS VAPID incomplète')+
        cadence+last+issue;
    }catch(error){pushStatus.textContent='Diagnostic Web Push indisponible : '+error.message;}
  };
  const test=el('syncPushTest');
  if(test)test.onclick=run(async()=>{
    if(!SyncClient.isNasActive())throw Error('Activer d’abord la surveillance autonome NAS');
    const result=await SyncClient.enrollPushIfGranted();
    if(result?.status==='permission-required')throw Error('Autoriser les notifications iOS avant ce test');
    const answer=await SyncClient.testPush();
    pushStatus.textContent=answer.scheduled?
      'Test programmé : ferme complètement la PWA ; le worker NAS enverra une notification dans 15 secondes.':
      'Le test NAS n’a pas pu être planifié.';
  });
  refreshPush();
}
