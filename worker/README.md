# AlphaTerminal Worker — v1.2.0 (profils libres et restauration chiffrée)

Moteur NAS Python 3.12, FastAPI, SQLite et Web Push. **Aucun compte ni portefeuille n'est inclus dans ce dépôt.**

## Prérequis

- NAS x86_64 ou ARM64 avec Docker Compose ; capacité persistante pour `/data`.
- Un nom DNS **HTTPS public** (reverse proxy NAS ou tunnel HTTPS). Ne pas exposer `18878` directement sur Internet.
- Un nom d'origine PWA `https://sicho95.github.io` pour CORS ; l'app hébergée sur GitHub Pages conserve son chemin `/AlphaTerminal/`.
- Pour iOS : PWA installée à l'écran d'accueil, notifications autorisées par geste utilisateur.

## Démarrage (ne pas exposer sans HTTPS)

```sh
cd worker
cp .env.example .env
python3 -c 'import secrets;print(secrets.token_urlsafe(32))'
# Insérer le secret ci-dessus comme AT_BOOTSTRAP_CODE dans .env
# Ajouter dans .env : AT_VAPID_SUBJECT=mailto:VOTRE_ADRESSE
mkdir -p state
sudo chown -R 10001:10001 state
chmod 700 state
chmod 600 .env
docker compose build
docker compose up -d
curl http://127.0.0.1:18878/health
```

**Configurer le reverse proxy HTTPS avant d'appairer un iPhone.** Mapper l'URL publique vers `127.0.0.1:18878`. Pour les mises à jour : `docker compose up -d --build`. Le conteneur n'a pas besoin des ports d'administration QNAP.

La base SQLite, la clé VAPID et la clé de coffre `recovery_vault.key` sont créées dans `worker/state/` (non versionnées) sous l'UID `10001`. **Sauvegarder ensemble les fichiers `.sqlite3`, `.pem` et `recovery_vault.key`** ; pour les copies à chaud, employer l'API de backup SQLite ou arrêter proprement le conteneur. Le mode WAL implique que la copie isolée d'un `.sqlite3` pendant une écriture n'est pas une sauvegarde cohérente.

## Utilisation dans la PWA

1. Dans Paramètres > Synchronisation NAS, choisir le nom du profil et de l'appareil puis cliquer « Créer un profil ». **Aucun code administrateur n'est demandé à l'utilisateur.**
2. Le premier appareil transmet ses paramètres (hors clés/secrets) et ses positions, dans le modèle local-first existant. Dans Paramètres, cocher « Surveillance autonome sur NAS », enregistrer.
3. Cliquer « Activer Web Push NAS » **sur l'appareil concerné** après acceptation iOS. Chaque téléphone reçoit son propre abonnement.
4. Pour un second appareil : « Demander un code » ; sur le premier saisir le code avec « Autoriser le code » ; sur le nouveau « Terminer ». Un nouveau token de session est délivré, distinct du premier.
5. Les modifications enregistrées localement sont mises en file d'attente et poussées ; l'appareil consulte le NAS au premier plan et toutes les 60 secondes lorsqu'il est actif.
6. **En cas de conflit** l'application n'écrase pas silencieusement ; un choix explicite est nécessaire.

Pour créer un profil familial distinct, la seconde personne crée son propre profil librement depuis son téléphone ; chaque profil possède un identifiant et un secret de récupération distincts. L'export global chiffré et la restauration par mot de passe se trouvent dans Paramètres > Sauvegardes. Consulter [la procédure v1.2](../docs/backup-recovery-v1.2.md).

## API (v1)

- `GET /health`: disponibilité.
- `POST /api/v1/profiles/create`: création publique et bornée par quotas d'un profil indépendant.
- `GET /api/v1/profiles/recovery` et `POST /api/v1/profiles/recover`: preuve de récupération et nouveau jeton d'appareil sans dupliquer le profil NAS.
- `GET /admin` + `/api/v1/admin/profiles`: console NAS protégée par code administrateur pour suspendre/réactiver/supprimer les profils.
- `POST /api/v1/setup/add-profile`: ancienne création administrative encore disponible par compatibilité ; **ne pas utiliser pour les utilisateurs ordinaires**.
- `POST /api/v1/pair/start`, `pair/approve`, `pair/claim`: association, code six chiffres expirant en cinq minutes, autorisation depuis ancien appareil.
- `GET /api/v1/sync/state`, `POST /api/v1/sync/changes`: snapshots / patch avec vérification des révisions. Paramètres fusionnés par clé, portefeuilles en CAS sur la révision globale.
- `GET /api/v1/alerts`: événements persistants.
- `GET /api/v1/devices`, `POST /api/v1/devices/{id}/revoke`: appareils actifs / révocation.
- `GET /api/v1/push/key`, `POST /api/v1/push/subscribe`: clé publique VAPID / enregistrement abonnement d'appareil.

Toute API personnelle exige `Authorization: Bearer ...`, à l'exception des routes d'appairage et création protégées spécifiquement. Jetons hachés côté serveur, empreintes non réversibles. Une fuite d'un jeton dans le localStorage du navigateur donne accès au profil : éviter les extensions non fiables et préserver la confidentialité des exports.

## Cours & news

- Worker de stops : Yahoo Chart (non officiel), cours mis en cache de fait pour tous les profils d'un cycle ; seuils indépendants, transitions anti-doublons ; au minimum toutes les 5 minutes, 10 par défaut. Aucun stop automatique transmis à un courtier.
- News : OKSURF, Yahoo Search ciblé (source non officielle à débit borné), GDELT DOC, RSS Café de la Bourse, AMF et BCE ; 30 minutes par défaut. Le moteur rapproche une société directement nommée, ou un thème macro avec une exposition ETF documentée (champ `sector`), et classe important/critique.
- Initialisation news : le premier lot sert de référence et **n'envoie pas de Web Push**, pour éviter une avalanche de vieilles news.
- Si l'API ou le flux ne fonctionne pas : pas de notification déduite d'informations obsolètes. Les sources peuvent varier, être restreintes, et nécessiter des adaptations.
- Les calculs PWA existants restent disponibles en mode local. Le serveur *n'est pas une autorité financière* et ne formule pas de recommandations d'ordres.

## Tests

```sh
cd worker
PYTHONPATH=. python3 -m unittest discover -s tests -v
cd ..
node --test tests/test-alerts.mjs
```

**Limites de validation :** tests automatisés avec sources mockées ou événements synthétiques ; aucune vraie livraison Apple Web Push, aucune synchronisation vérifiée sur iOS/QNAP dans ce lot. La publication GitHub et le déploiement NAS restent des opérations explicites.

## Sécurité / limites connues

- L'application ne prend pas en charge le chiffrement de bout en bout. Les données sont chiffrées par HTTPS en transport mais sont lisibles sur le NAS ; protéger le NAS et les sauvegardes.
- La synchronisation repose sur des révisions et non sur un CRDT complet. Les changements concurrents du même paramètre ou des positions déclenchent un conflit.
- Les vrais prix peuvent être différés ou incorrects : le Worker ignore les cours invalides ou trop anciens ; les marchés fermés produisent moins d'alertes.
- Le NAS doit conserver son horloge à l'heure.
- Les endpoints de la PWA sont publics, mais les routes personnelles doivent rester authentifiées. Configurer rate-limit/WAF en amont du reverse proxy si exposé sur Internet.


## Duplication Forgejo et déploiement continu

Consulter [`../docs/forgejo-tailscale-cicd.md`](../docs/forgejo-tailscale-cicd.md), notamment le script de miroir unique, le volume `AT_HOST_DATA_DIR` extérieur aux releases et le proxy Tailscale Serve sur un port HTTPS distinct. Ne jamais utiliser `tailscale serve reset` lorsque d’autres routes existent.


### QNAP nas-damien — port 18878

Le port hôte 8787 est utilisé par SichoBooks (`/livres` en Tailscale Funnel). Depuis le correctif du 26/10/2026, **AlphaTerminal utilise `127.0.0.1:${AT_HOST_PORT:-18878}`**, et le script `deploy-from-forgejo.sh` vérifie ce port. Configurer `AT_HOST_PORT=18878` dans le fichier NAS `config/worker.env` et vérifier qu'il est disponible avant de déployer. L'API ne doit pas être rendue publique par Funnel avant revue de sécurité ; un HTTPS Serve privé est préférable pour démarrer.
