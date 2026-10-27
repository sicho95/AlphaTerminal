# AlphaTerminal v1.2 — profils NAS libres et sauvegarde globale chiffrée

## Parcours utilisateur

- L'application demeure **100 % locale par défaut**, sans inscription.
- La synchronisation sur `https://nas-damien.tailfb6907.ts.net/alphaterm` est facultative. Chaque utilisateur crée lui-même un profil NAS (pas de `AT_BOOTSTRAP_CODE` à saisir ou partager).
- Le nom de profil n'est **pas** une identité de sécurité : chaque profil possède un `profile_id` aléatoire et un `recovery_secret` secret, générés par le worker.
- Plusieurs appareils sont associés au même profil avec un code éphémère validé par un appareil existant, ou par **restauration d'une sauvegarde chiffrée**.
- Chaque appareil possède son propre `device_id` et jeton : restaurer le JSON ne copie pas l'identité technique de l'ancien téléphone.
- Les portefeuilles et paramètres sont synchronisés vers le profil NAS ; les clés Web Push et autorisations iOS restent propres à chaque appareil.

## Sauvegarde unique

Dans **Paramètres → Sauvegardes** : définir une phrase de passe (12 caractères minimum), exporter un seul JSON chiffré, ou restaurer.

- Dérivation de la clé : PBKDF2-SHA-256, sel aléatoire 128 bits, 310 000 itérations.
- Chiffrement : AES-256-GCM, nonce aléatoire 96 bits **différent pour chaque export**.
- Le mot de passe n'est pas conservé par l'application. L'utilisateur peut l'enregistrer **manuellement** dans son trousseau/gestionnaire (Safari ne permet pas d'imposer un enregistrement au trousseau).
- Une `CryptoKey` **non exportable** est persistée localement via IndexedDB ; les exports et restaurations compatibles sur le même appareil ne demandent plus de mot de passe.
- Un appareil neuf ou doté d'une clé incompatible demande le mot de passe et mémorise la nouvelle clé après déchiffrement réussi.
- Le JSON **chiffré** contient données, préférences, alertes, et éventuellement `{url, profile_id, recovery_secret}` du NAS. Il **n'embarque aucun jeton d'appareil**.
- L'identité/nom de l'appareil de destination est conservé, ou choisi localement lors de la première restauration.
- Le backend retrouve le **même** `profile_id`, délivre au nouvel appareil un **nouveau** jeton, et ne recrée aucune surveillance autonome.
- En présence de données NAS : le choix par défaut est de conserver les données actuelles du NAS ; écraser le NAS depuis le fichier requiert une **confirmation explicite**. Les révisions CAS restent actives.
- Les anciens JSON v1.1 non chiffrés peuvent être importés comme migration locale après confirmation ; **ils ne contiennent pas de preuve de récupération NAS**.

## Sécurité NAS

- `POST /api/v1/profiles/create` : inscription libre avec quotas en base sur 24 h, limite par client et plafond de profils (`AT_MAX_PROFILES` 60, `AT_SIGNUPS_PER_DAY` 20, `AT_SIGNUPS_PER_IP_DAY` 5 par défaut).
- `GET /api/v1/profiles/recovery` : accessible uniquement à un **appareil autorisé**. Permet notamment la migration des profils antérieurs à v1.2.
- `POST /api/v1/profiles/recover` : preuve `profile_id` + `recovery_secret`, jeton d'appareil neuf, tentative limitée ; aucune simple correspondance de noms n'accorde un accès.
- Les preuves de récupération sont **hachées** dans SQLite. Un exemplaire est aussi stocké chiffré AES-GCM dans SQLite afin que les appareils autorisés puissent sauvegarder à leur tour, avec une clé locale persistante distincte `recovery_vault.key`.
- Le dossier NAS `/share/CE_CACHEDEV1_DATA/Container/AlphaTerminal/data` doit conserver **ensemble** `alphaterminal.sqlite3`, les fichiers SQLite WAL/SHM éventuels, `vapid_private.pem` et `recovery_vault.key`. Pour la cohérence de SQLite, arrêter le worker ou faire un backup SQLite en ligne ; ne pas copier la DB seule à chaud.
- La fonction d'administration globale reste derrière `AT_BOOTSTRAP_CODE` côté opérateur. **Ne jamais afficher ni communiquer ce secret aux utilisateurs.**
- Le serveur public reste soumis au risque de consommation de quota/DoS, même avec quotas. Surveiller les journaux et la capacité ; aucun système de création libre sur Internet n'est invulnérable aux abus.

## Déploiement / non-régression

1. Sauvegarder `/data` **avant** mise à niveau du worker. La migration SQL ajoute trois colonnes à `profiles` sans supprimer les anciennes.
2. Conserver dans Portainer les montages, variables et le port `127.0.0.1:18878`.
3. Mettre à jour GitHub `main`, puis vérifier le pull mirror `sicho/AlphaTerminal` dans Forgejo. Portainer déploie le worker si GitOps est effectivement activé.
4. Vérifier `GET /health`, l'API authentifiée (401 sans jeton), et le champ `version` à la racine de l'OpenAPI côté worker.
5. Tester sur **profils fictifs** : nouveau profil NAS sans code, aller/retour iPhone-Mac, double export au même appareil, restauration sans mot de passe avec clé compatible, restauration avec mot de passe sur terminal neuf, aucune duplication de `profile_id`, conflits NAS, notifications iOS.
6. Tester la conservation des cinq routes Tailscale existantes et `/alphaterm`. Ne jamais lancer `tailscale serve reset`.
7. La PWA peut mettre plusieurs lancements avant que le service worker iOS renouvelle son cache `alphaterminal-v22`. Ne **pas** effacer les données de la PWA ni désinstaller sans export confirmé.

## Points de vigilance

- Le secret dans une sauvegarde chiffrée est suffisant pour réclamer une nouvelle autorisation sur le profil NAS ; protéger **fichier ET mot de passe**.
- Les clés non exportables IndexedDB protègent contre l'extraction directe, **pas** contre un script exécuté dans l'origine de l'application.
- Le NAS n'a pas de chiffrement de bout en bout des portefeuilles : SQLite côté serveur contient les données en clair pour le moteur autonome.
- La nouvelle page d'administration graphique de gestion des profils/suppression est **hors de ce lot** ; ne pas exposer une interface d'administration non protégée à Funnel public.
