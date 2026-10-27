# AlphaTerminal 1.2.1 — contrat de surveillance local / NAS

## Contrat
- **Une seule configuration de règles versionnées** : `shared/monitor-rules.json`, référencée par l’application et copiée **sans duplication** dans l’image Docker via `worker/Dockerfile`. Les valeurs de secours locales doivent lui être identiques (vérifié par CI).
- Pour un profil local : rafraîchissement navigateur Yahoo Finance, calcul stop franchi / stop proche / performance PRU / RSI et suggestions ATR par portefeuille selon la configuration utilisateur ; sources news Yahoo Finance, OKSURF, RSS AMF/BCE/Café de la Bourse, GDELT si accessibles au navigateur.
- Avec `dynamicEnabled=true` **et** un appareil associé : le worker NAS devient l’autorité pour les cotations, les règles d’alertes et les actualités. L’application ne recrée pas les alertes locales en parallèle. Le worker émet les Web Push même lorsque toutes les applications sont fermées, pour les types qu’il évalue et si l’appareil est abonné.
- `GET /api/v1/monitor/state` (Bearer du terminal) expose le contrat v2, version des règles, snapshots Yahoo OHLC, ATR, stop suggéré, alertes et actualités de sources configurées.
- La sélection du profil investisseur sur chaque portefeuille (champ `profileId`) et la surcharge `atrMultiplier` sur chaque position alimentent les calculs ATR du NAS ; aucun seuil ATR suggéré ne déclenche un stop sans `stopLevel` explicite. Les paramètres de profil, les stopLevels et les listes de titres sont déjà synchronisés dans SQLite NAS.
- Un même réglage d’actualisation : `autoRefreshMinutes` de **5 à 120 minutes**. Le scheduler worker vérifie les échéances individuellement par profil et mutualise les appels de cours Yahoo. Actualités : au minimum 15 minutes afin de réduire les appels.
- News : le moteur NAS cible les positions avec filtres de pertinence/déduplication. L’interface montre le flux NAS central ; en mode local, le navigateur peut consulter les mêmes quatre familles de sources. Une équivalence totale du classement de toutes les actualités entre Python et navigateur nécessite encore un contrat analytique partagé : ne pas prétendre que tous les commentaires macro sont strictement identiques.

## Notifications
- Consentement explicite OS depuis **Paramètres → Alertes → Activer notifications iOS** ; la permission doit être accordée par iOS, depuis la PWA installée sur l'écran d'accueil (iPhone). Si un profil NAS dynamique est lié et la permission est accordée, la PWA enregistre **automatiquement** son abonnement Push avec le worker.
- `GET /api/v1/push/status` (Bearer) affiche l’abonnement actuel et les derniers succès/échecs de livraison. `POST /api/v1/push/test` programme l’envoi **réel** par le worker 15 secondes plus tard pour permettre de fermer l’application.
- Web Push n’est pas le même mécanisme que `showNotification` local ; ni l’un ni l’autre ne garantissent une remise immédiate en cas de restrictions iOS, réseau, mauvaise configuration VAPID ou économies d’énergie. Toujours vérifier l’endpoint, les journaux NAS et la réception réelle sur écran verrouillé.
- L’ancien bouton « Activer Web Push NAS » est supprimé, de même que l’appairage en quatre étapes. L’ancien appareil déjà associé génère un code de six chiffres valable cinq minutes ; le nouveau le saisit une fois. Seul le serveur authentifié relie le nouvel appareil au profil existant.

## Sauvegardes et conflits
- Export JSON chiffré intégral incluant la révision NAS au moment de l’export.
- À la restauration, comparer `settings_rev` et `data_rev` du JSON et du NAS. NAS plus récent : demander explicitement quelle version conserver. NAS plus ancien ou même révision avec des différences : restaurer les données JSON. Ancien JSON sans révisions : demander si les deux divergeaient.
- La clé crypto IndexedDB ne peut déchiffrer un fichier que si son sel KDF et sa clé sont compatibles. Deux appareils ayant défini **indépendamment** le même mot de passe produisent des clés différentes à cause du sel : la première restauration demande le mot de passe, puis la clé correcte est mémorisée.
- Sauvegarder l’intégralité du volume worker avant mise à jour : SQLite, clés VAPID, `recovery_vault.key`. La migration crée des tables de mesures NAS et des colonnes complémentaires sans supprimer les données antérieures.

## Déploiement / recette
- Le contexte de build Docker est désormais la **racine du dépôt**, avec `dockerfile: worker/Dockerfile`, pour embarquer `shared/monitor-rules.json`. Vérifier que Portainer GitOps utilise bien le dépôt complet après synchronisation Forgejo.
- Tests GitHub CI : Node, Python/FastAPI, image Docker et tests HTTP de santé/authentification. Les tests automatisés ne remplacent pas la vraie réception Web Push iOS PWA fermée, et la migration sur le volume QNAP doit être vérifiée séparément.
