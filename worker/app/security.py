"""Jetons cryptographiquement aléatoires par appareil; seule leur empreinte est persistée."""
import hashlib
import hmac
import secrets
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
    row=db.execute('SELECT id,profile_id,revoked FROM devices WHERE token_hash=?',(digest(token),)).fetchone()
    if not row or row['revoked']:
        raise HTTPException(401,'Appareil non autorisé')
    return row

def check_bootstrap(code):
    import os
    configured=os.getenv('AT_BOOTSTRAP_CODE','')
    if len(configured)<24 or not hmac.compare_digest(code,configured):
        raise HTTPException(403,'Code administrateur incorrect')
