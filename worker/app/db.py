"""SQLite persistante, révisions CAS, transactions courtes; aucune donnée réelle en dépôt."""
import json
import os
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

_LOCK = threading.RLock()

def now():
    return datetime.now(timezone.utc).isoformat()

def connect():
    directory = Path(os.getenv('AT_DATA_DIR', '/tmp/alphaterminal-data'))
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    c = sqlite3.connect(str(directory / 'alphaterminal.sqlite3'), timeout=15, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA busy_timeout=15000')
    return c

@contextmanager
def read_db():
    db=connect()
    try: yield db
    finally: db.close()

@contextmanager
def transaction():
    with _LOCK:
        db = connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

def init():
    with transaction() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS profiles(
          id TEXT PRIMARY KEY, name TEXT NOT NULL, settings_json TEXT NOT NULL DEFAULT '{}',
          data_json TEXT NOT NULL DEFAULT '{}', settings_rev INTEGER NOT NULL DEFAULT 0,
          data_rev INTEGER NOT NULL DEFAULT 0, news_initialized INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS devices(
          id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id),
          name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
          push_json TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pairs(
          id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, claim_hash TEXT NOT NULL,
          device_name TEXT NOT NULL, expires_at REAL NOT NULL, profile_id TEXT,
          issued_token TEXT, issued_device TEXT, claimed INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS setting_edits(
          profile_id TEXT NOT NULL REFERENCES profiles(id), k TEXT NOT NULL,
          rev INTEGER NOT NULL, PRIMARY KEY(profile_id,k));
        CREATE TABLE IF NOT EXISTS alerts(
          id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id),
          kind TEXT NOT NULL, dedup_key TEXT NOT NULL, payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL, UNIQUE(profile_id,dedup_key));
        CREATE TABLE IF NOT EXISTS alert_states(
          profile_id TEXT NOT NULL, position_id TEXT NOT NULL, kind TEXT NOT NULL,
          active INTEGER NOT NULL, PRIMARY KEY(profile_id,position_id,kind));
        CREATE TABLE IF NOT EXISTS seen_news(
          profile_id TEXT NOT NULL, article_hash TEXT NOT NULL,
          created_at TEXT NOT NULL, PRIMARY KEY(profile_id,article_hash));
        ''')
        # Migration additive: les profils et appareils v1.1 existants sont préservés.
        columns={r['name'] for r in c.execute('PRAGMA table_info(profiles)')}
        if 'recovery_hash' not in columns:
            c.execute('ALTER TABLE profiles ADD COLUMN recovery_hash TEXT')
        if 'recovery_secret_enc' not in columns:
            c.execute('ALTER TABLE profiles ADD COLUMN recovery_secret_enc TEXT')
        if 'disabled' not in columns:
            c.execute('ALTER TABLE profiles ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0')
        c.execute('''CREATE TABLE IF NOT EXISTS profile_signups (
            id TEXT PRIMARY KEY, ip_hash TEXT NOT NULL, created_at TEXT NOT NULL
        )''')
        c.execute('CREATE INDEX IF NOT EXISTS signup_date_idx ON profile_signups(created_at)')

def new_id(prefix):
    return f'{prefix}_{secrets.token_urlsafe(12)}'

def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

class Conflict(Exception):
    def __init__(self, kind, keys=None):
        self.kind, self.keys = kind, keys or []
        super().__init__(kind)

def profile_state(c, profile_id):
    r = c.execute('SELECT * FROM profiles WHERE id=?', (profile_id,)).fetchone()
    return {'settings':json.loads(r['settings_json']), 'data':json.loads(r['data_json']),
            'settings_rev':r['settings_rev'], 'data_rev':r['data_rev'], 'profile_name':r['name']}

def apply_changes(c, profile_id, payload):
    """Merge des clés de paramètres, CAS pour les données de portefeuille."""
    state = profile_state(c, profile_id)
    patch = payload.get('settings_patch') or {}
    if patch:
        base = payload.get('settings_base_rev')
        if not isinstance(base, int) or base < 0:
            raise ValueError('settings_base_rev missing')
        conflicting = [k for k in patch if (c.execute('SELECT rev FROM setting_edits WHERE profile_id=? AND k=?',
                        (profile_id,k)).fetchone() or {'rev':0})['rev'] > base]
        if conflicting: raise Conflict('settings', conflicting)
        settings = state['settings'] | patch
        rev = state['settings_rev'] + 1
        c.execute('UPDATE profiles SET settings_json=?,settings_rev=? WHERE id=?', (compact(settings),rev,profile_id))
        for key in patch:
            c.execute('INSERT INTO setting_edits(profile_id,k,rev) VALUES(?,?,?) ON CONFLICT(profile_id,k) DO UPDATE SET rev=excluded.rev', (profile_id,key,rev))
    if 'data' in payload:
        expected = payload.get('data_base_rev')
        if expected != state['data_rev']: raise Conflict('data')
        c.execute('UPDATE profiles SET data_json=?,data_rev=data_rev+1 WHERE id=?', (compact(payload['data']),profile_id))
    return profile_state(c, profile_id)
