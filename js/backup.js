/** Sauvegarde intégrale chiffrée, avec cle Web Crypto non exportable en IndexedDB. */
import { exportBackup,importBackup } from './store.js';
import { SyncClient } from './sync-client.js';

const DB='AlphaTerminalBackupKeysV1';
const ITERATIONS=310000;
const FORMAT='alphaterminal-encrypted-backup';
export const BackupCrypto={deriveKey:(password,salt,iterations=ITERATIONS)=>derive(password,salt,iterations)};
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=bytes=>{
  let result='';
  for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(result);
};
const un64=value=>Uint8Array.from(atob(value),v=>v.charCodeAt(0));
const random=n=>crypto.getRandomValues(new Uint8Array(n));
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const openDb=()=>new Promise((resolve,reject)=>{
  const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>r.result.createObjectStore('vault',{keyPath:'id'});
  r.onsuccess=()=>resolve(r.result);
  r.onerror=()=>reject(r.error);
});
async function vault(write){
  const db=await openDb();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('vault',write?'readwrite':'readonly');
      const store=tx.objectStore('vault');
      const req=write?store.put(write):store.get('primary');
      req.onsuccess=()=>resolve(write||req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }finally{db.close();}
}
async function derive(password,salt,iterations=ITERATIONS){
  const base=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',hash:'SHA-256',salt,iterations},base,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
}
function download(object){
  const blob=new Blob([JSON.stringify(object)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='AlphaTerminal-sauvegarde-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function deviceName(){
  let name=localStorage.getItem('alphaTerm_deviceName');
  if(!name){
    const fallback=/iPhone/.test(navigator.userAgent)?'iPhone':/iPad/.test(navigator.userAgent)?'iPad':'Nouvel appareil';
    name=prompt('Nom de cet appareil (conservé localement)',fallback)?.trim()||fallback;
    localStorage.setItem('alphaTerm_deviceName',name.slice(0,80));
  }
  return name;
}
export const BackupVault={
  async hasKey(){return Boolean((await vault())?.key);},
  async setPassword(password){
    if(!password||password.length<12)throw Error('Choisir une phrase de passe d’au moins 12 caractères');
    const current=await vault();
    if(current&&!confirm('Remplacer le mot de passe de sauvegarde pour les futurs exports ? Les anciens fichiers garderont leur ancien mot de passe.'))return false;
    const salt=random(16),key=await derive(password,salt);
    await vault({id:'primary',salt:b64(salt),iterations:ITERATIONS,key});
    return true;
  },
  async export(){
    const record=await vault();
    if(!record?.key)throw Error('Définir d’abord un mot de passe de sauvegarde');
    const payload={...exportBackup(),backupVersion:1,nas:await SyncClient.ensureRecovery(),
      nasSync:SyncClient.session?.token?{
        revisions:{...SyncClient.revs},
        hadPendingChanges:Object.keys(SyncClient.pending||{}).length>0
      }:null};
    // Aucun token d'appareil dans les sauvegardes : nouveau terminal, nouvelle autorisation.
    const iv=random(12);
    const bytes=enc.encode(JSON.stringify(payload));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},record.key,bytes);
    download({format:FORMAT,version:1,kdf:{name:'PBKDF2',hash:'SHA-256',
      iterations:record.iterations,salt:record.salt},cipher:{name:'AES-256-GCM',iv:b64(iv)},
      ciphertext:b64(new Uint8Array(encrypted))});
  },
  async restore(file,password=''){
    if(file.size>25*1024*1024)throw Error('Fichier supérieur à 25 Mo');
    let json;
    try{json=JSON.parse(await file.text());}catch{throw Error('Fichier JSON invalide');}
    let payload,derived=null,usedDerived=false;
    if(json.format===FORMAT){
      if(json.version!==1||json.kdf?.name!=='PBKDF2'||json.kdf?.hash!=='SHA-256'||json.cipher?.name!=='AES-256-GCM')
        throw Error('Format de sauvegarde non pris en charge');
      const iterations=json.kdf.iterations;
      if(!Number.isInteger(iterations)||iterations<100000||iterations>1000000)
        throw Error('Paramètres de chiffrement invalides');
      const salt=un64(json.kdf.salt),iv=un64(json.cipher.iv);
      if(salt.length!==16||iv.length!==12)throw Error('Paramètres cryptographiques invalides');
      const local=await vault();
      const tryKeys=[];
      if(local?.key&&local.iterations===iterations&&equal(un64(local.salt),salt))tryKeys.push(local.key);
      if(password)tryKeys.push(derived=await derive(password,salt,iterations));
      if(!tryKeys.length)throw Error('PASSWORD_REQUIRED');
      let clear=null;
      for(const key of tryKeys){
        try{
          clear=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,un64(json.ciphertext));
          usedDerived=Boolean(derived&&key===derived);
          break;
        }catch{ /* cle incompatible : utiliser le mot de passe */ }
      }
      if(!clear)throw Error('PASSWORD_REQUIRED');
      try{payload=JSON.parse(dec.decode(clear));}catch{throw Error('Sauvegarde déchiffrée non valide');}
    }else{
      if(!json?.data||!json?.settings)throw Error('Sauvegarde incompatible');
      if(!confirm('Ancien export non chiffré détecté. Importer ces données locales ?'))return 'cancelled';
      payload=json;
    }
    if(!payload?.data||!Array.isArray(payload.data.portfolios)||!payload.settings)
      throw Error('Sauvegarde incomplète ou endommagée');
    const existing=SyncClient.session;
    if(existing?.token&&!payload.nas){
      throw Error('Ce terminal utilise déjà un profil NAS. Pour éviter d’orpheliner sa surveillance, restaurer un fichier complet associé au même NAS sur cet appareil.');
    }
    if(existing?.token&&payload.nas?.profile_id&&existing.profile_id!==payload.nas.profile_id){
      if(!confirm('Ce terminal est déjà relié à un AUTRE profil NAS. Le remplacer par celui de cette sauvegarde ?'))
        return 'cancelled';
    }
    if(!confirm('Restaurer les données et paramètres de ce fichier sur cet appareil ?'))return 'cancelled';
    // Dès le déchiffrement accepté, garder localement la clé correcte même si le NAS est hors ligne.
    if(derived&&usedDerived){
      await vault({id:'primary',salt:json.kdf.salt,iterations:json.kdf.iterations,key:derived});
    }
    // Les notifications iOS, l'identité et les jetons des appareils restent indépendants.
    const wasApplying=SyncClient.applying;
    SyncClient.applying=true;
    try{importBackup(payload,'replace');}finally{SyncClient.applying=wasApplying;}
    if(payload.nas?.recovery_secret){
      try{
        await SyncClient.restoreConnection(payload.nas,deviceName(),'auto',payload.nasSync);
        return 'restored-with-nas';
      }catch(error){
        console.warn('La sauvegarde locale est restaurée, mais le NAS est injoignable ou refuse la récupération',error.status);
        return 'restored-local-nas-unavailable';
      }
    }
    return payload.nas?'restored-local-nas-unavailable':'restored-local';
  }
};
