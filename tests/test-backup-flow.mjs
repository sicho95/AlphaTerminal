import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Node 22 fournit WebCrypto via globalThis.crypto en lecture seule.
const dbRecords=new Map();
const asyncRequest=fn=>{
  const r={};
  queueMicrotask(()=>{
    try{r.result=fn();r.onsuccess?.({target:r});}
    catch(e){r.error=e;r.onerror?.({target:r});}
  });
  return r;
};
const fakeDb={
  createObjectStore(){},
  transaction(){return {objectStore(){return {
    get:key=>asyncRequest(()=>dbRecords.get(key)),
    put:value=>asyncRequest(()=>{dbRecords.set(value.id,value);return value.id;})
  };}};},
  close(){}
};
globalThis.indexedDB={open:()=> {
  const r={};
  queueMicrotask(()=>{
    r.result=fakeDb;
    if(!dbRecords.has('__initialized')){
      dbRecords.set('__initialized',true);
      r.onupgradeneeded?.({target:r});
    }
    r.onsuccess?.({target:r});
  });
  return r;
}};
const local=new Map();
globalThis.localStorage={
  getItem:k=>local.has(k)?local.get(k):null,
  setItem:(k,v)=>local.set(k,String(v)),
  removeItem:k=>local.delete(k)
};
globalThis.window={dispatchEvent(){}};
globalThis.document={
  dispatchEvent(){},
  body:{append(){}},
  createElement:()=>({click(){},remove(){}})
};
globalThis.confirm=()=>true;
let lastBlob=null;
URL.createObjectURL=blob=>{lastBlob=blob;return 'blob:mock';};
URL.revokeObjectURL=()=>{};
const store=await import('../js/store.js');
const {BackupVault}=await import('../js/backup.js');

test('local encrypted JSON backup/restoration: no password twice, no device-name overwrite',async()=>{
  store.initStore({schemaVersion:2,owners:[],portfolios:[]});
  const expected={schemaVersion:2,owners:[{id:'owner-test',name:'Utilisateur test'}],portfolios:[
    {id:'portfolio-test',ownerId:'owner-test',name:'PEA fictif',type:'PEA',
    positions:[{id:'position-test',ticker:'TEST.PA',name:'Action fictive',qty:5,pru:20}]}]};
  store.saveData(expected);
  store.saveSettings({darkMode:true,autoRefreshMinutes:23});
  localStorage.setItem('alphaTerm_deviceName','iMac personnel');
  assert.equal(await BackupVault.hasKey(),false);
  await BackupVault.setPassword('une phrase de passe très longue');
  assert.equal(await BackupVault.hasKey(),true);
  await BackupVault.export();
  assert.ok(lastBlob);
  const encrypted=JSON.parse(await lastBlob.text());
  assert.equal(encrypted.format,'alphaterminal-encrypted-backup');
  assert.equal(encrypted.version,1);
  assert.equal(encrypted.kdf.iterations,310000);
  assert.ok(!JSON.stringify(encrypted).includes('PEA fictif'));
  const file=lastBlob;
  store.saveData({schemaVersion:2,owners:[],portfolios:[]});
  store.saveSettings({darkMode:false,autoRefreshMinutes:11});
  assert.equal(await BackupVault.restore(file), 'restored-local');
  assert.equal(store.getData().portfolios[0].name,'PEA fictif');
  assert.equal(store.getSettings().autoRefreshMinutes,23);
  assert.equal(localStorage.getItem('alphaTerm_deviceName'),'iMac personnel');
  // Une autre clé locale invalide ne suffit pas à restaurer cette sauvegarde.
  await BackupVault.setPassword('mot de passe de remplacement test');
  await assert.rejects(BackupVault.restore(file),/PASSWORD_REQUIRED/);
  assert.equal(await BackupVault.restore(file,'une phrase de passe très longue'),'restored-local');
  assert.equal(store.getData().portfolios[0].name,'PEA fictif');
});
