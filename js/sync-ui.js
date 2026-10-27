/** User-initiated pairing. No automatic account signup or export from old 1.0.0. */
import { SyncClient } from './sync-client.js';

export function initSyncUI(){
  const find=id=>document.getElementById(id);
  if(!find('syncServer'))return;
  const status=find('syncStatus');
  const show=(message)=>{status.textContent=message;};
  const off=SyncClient.onChange(show);
  show(SyncClient.status);
  find('syncServer').value=SyncClient.session?.url||'';
  find('syncName').value=SyncClient.session?.profile_name||'';
  find('syncDevice').value=localStorage.getItem('alphaTerm_deviceName')||'';
  const fail=fn=>async()=>{try{await fn();}catch(e){show(`Erreur : ${e.message}`);}};
  find('syncCreate').onclick=fail(async()=>{
    const name=find('syncName').value.trim(),device=find('syncDevice').value.trim()||'Mon appareil';
    if(!name)throw Error('Indiquer un nom de profil');
    const creds=await SyncClient.newProfile(find('syncServer').value,name,device);
    show(`Profil ${creds.profile_name} créé et synchronisé. Pense à exporter une sauvegarde chiffrée.`);
  });
  find('syncPairStart').onclick=fail(async()=>{
    const p=await SyncClient.startPair(find('syncServer').value,find('syncDevice').value.trim()||'Nouvel appareil');
    show(`Code à saisir sur l'ancien appareil : ${p.code} (valable 5 min). Puis cliquer « Terminer ». `);
  });
  find('syncPairApprove').onclick=fail(async()=>{
    const result=await SyncClient.approve(find('syncPairCode').value.trim());
    show(`${result.paired_device} autorisé. Tu peux terminer sur le nouvel appareil.`);
    find('syncPairCode').value='';
  });
  find('syncPairClaim').onclick=fail(async()=>{
    const result=await SyncClient.claim();
    show(result.status==='ready'?'Profil restauré et appareil connecté.':result.status==='pending'?'En attente de validation par un appareil déjà connecté.':'Restauration annulée.');
  });
  find('syncNow').onclick=fail(async()=>{await SyncClient.flush();show(SyncClient.status);});
  find('syncPush').onclick=fail(async()=>{await SyncClient.enablePush();show('Abonnement Web Push NAS actif sur cet appareil.');});
  find('syncServerWins').onclick=fail(async()=>{await SyncClient.resolve(false);show(SyncClient.status);});
  find('syncLocalWins').onclick=fail(async()=>{await SyncClient.resolve(true);show(SyncClient.status);});

}
