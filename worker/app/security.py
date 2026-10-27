"""Jetons cryptographiquement aléatoires par appareil; seule leur empreinte est persistée."""
import hashlib
import hmac
import secrets
import os
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException
from .db import new_id, now

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def issue_device(db, profile, name):
    token = secrets.token_urlsafe(36)
    device_id = new_id('device')
    db.execute('INSERT INTO devices(id,profile_id,name,token_hash,created_at) VALUES(?,?,?,?,?)',
               (device_id,profile,name[:80],digest(token),now()))
    return {'device_id':device_id,'token':token,'profile_id':profile}

def authorize(db, authorization):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401,'Jeton appareil requis')
    token = authorization[7:]
    if len(token) < 32 or len(token)>256:
        raise HTTPException(401,'Jeton invalide')
    row=db.execute('''SELECT d.id,d.profile_id,d.revoked,p.disabled FROM devices d
        JOIN profiles p ON p.id=d.profile_id WHERE d.token_hash=?''',(digest(token),)).fetchone()
    if not row or row['revoked'] or row['disabled']:
        raise HTTPException(401,'Appareil non autorisé')
    return row

def check_bootstrap(code):
    import os
    configured=os.getenv('AT_BOOTSTRAP_CODE','')
    if len(configured)<24 or not hmac.compare_digest(code,configured):
        raise HTTPException(403,'Code administrateur incorrect')


# La cle locale de coffre est generee une seule fois dans le volume /data persistant.
# La base contient une empreinte pour la preuve et un exemplaire chiffre afin que
# chaque appareil deja autorise puisse sauvegarder le secret de recuperation.
def _vault_key():
    directory=Path(os.getenv('AT_DATA_DIR','/tmp/alphaterminal-data'))
    path=directory/'recovery_vault.key'
    if not path.exists():
        try:
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as file:
                file.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
    raw=path.read_bytes()
    if len(raw)!=32:raise RuntimeError('Cle de recuperation NAS invalide')
    return raw

def issue_recovery(db,profile_id):
    secret=secrets.token_urlsafe(40)
    iv=secrets.token_bytes(12)
    encrypted=AESGCM(_vault_key()).encrypt(iv,secret.encode(),profile_id.encode())
    import base64
    wrapped=base64.urlsafe_b64encode(iv+encrypted).decode()
    db.execute('UPDATE profiles SET recovery_hash=?,recovery_secret_enc=? WHERE id=?',
               (digest(secret),wrapped,profile_id))
    return secret

def read_recovery(db,profile_id):
    row=db.execute('SELECT recovery_secret_enc FROM profiles WHERE id=?',(profile_id,)).fetchone()
    if row is None:raise HTTPException(404,'Profil inconnu')
    if not row['recovery_secret_enc']:
        return issue_recovery(db,profile_id) # migration des profils existants
    import base64
    blob=base64.urlsafe_b64decode(row['recovery_secret_enc'])
    return AESGCM(_vault_key()).decrypt(blob[:12],blob[12:],profile_id.encode()).decode()

def verify_recovery(db,profile_id,secret):
    if len(secret)<40 or len(secret)>160:
        raise HTTPException(401,'Preuve de recuperation incorrecte')
    row=db.execute('SELECT recovery_hash,disabled FROM profiles WHERE id=?',(profile_id,)).fetchone()
    if not row or row['disabled'] or not row['recovery_hash'] or not hmac.compare_digest(row['recovery_hash'],digest(secret)):
        raise HTTPException(401,'Preuve de recuperation incorrecte')
