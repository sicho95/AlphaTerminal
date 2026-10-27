import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { BackupCrypto } from '../js/backup.js';

test('encrypted backup key: wrong password cannot decrypt, AES-GCM authenticates', async () => {
  const salt=webcrypto.getRandomValues(new Uint8Array(16));
  const a=await BackupCrypto.deriveKey('phrase longue suffisamment secrète',salt,310000);
  const b=await BackupCrypto.deriveKey('phrase incorrecte 123456',salt,310000);
  assert.equal(a.extractable,false);
  const iv=webcrypto.getRandomValues(new Uint8Array(12));
  const payload=new TextEncoder().encode('{"portfolios":[],"settings":{"darkMode":true}}');
  const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},a,payload);
  const clear=await webcrypto.subtle.decrypt({name:'AES-GCM',iv},a,cipher);
  assert.equal(new TextDecoder().decode(clear),new TextDecoder().decode(payload));
  await assert.rejects(webcrypto.subtle.decrypt({name:'AES-GCM',iv},b,cipher));
});

test('AES-GCM backup nonces yield distinct ciphertext for same plaintext', async () => {
  const salt=webcrypto.getRandomValues(new Uint8Array(16));
  const key=await BackupCrypto.deriveKey('encore une phrase de passe solide',salt,310000);
  const iv1=webcrypto.getRandomValues(new Uint8Array(12));
  const iv2=webcrypto.getRandomValues(new Uint8Array(12));
  const msg=new TextEncoder().encode('AlphaTerminal');
  assert.notDeepEqual(iv1,iv2);
  const c1=await webcrypto.subtle.encrypt({name:'AES-GCM',iv:iv1},key,msg);
  const c2=await webcrypto.subtle.encrypt({name:'AES-GCM',iv:iv2},key,msg);
  assert.notDeepEqual(Buffer.from(c1),Buffer.from(c2));
});
