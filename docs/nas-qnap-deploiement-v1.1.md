# NAS QNAP — Recette et déploiement AlphaTerminal Worker 1.1.0

**Procédure pré-production.** Prérequis : accès SSH/Container Station, Docker Compose, sauvegarde NAS, DNS HTTPS stable et reverse proxy. **Ne pas modifier la PWA officielle 1.0.0 tant que le staging n'est pas prêt.**

## 1. Préparer l'espace NAS

Sur NAS, placer le seul dossier `worker/` dans un répertoire de travail persistant tel que `.../Container/AlphaTerminal/worker/` ; ne pas y copier les données d'export portefeuille en clair. Utiliser les chemins NAS réels, qui varient suivant le volume.

```sh
cd /chemin/reel/AlphaTerminal/worker
cp .env.example .env
python3 -c 'import secrets;print(secrets.token_urlsafe(32))'
# Remplacer la valeur AT_BOOTSTRAP_CODE et renseigner AT_VAPID_SUBJECT=mailto:adresse@example.org
mkdir -p state
sudo chown -R 10001:10001 state
chmod 700 state
chmod 600 .env
docker compose up -d --build
docker compose ps
curl -sS http://127.0.0.1:8787/health
```

Si Python 3 n'est pas installé sur le NAS, générer le code aléatoire depuis ton Mac puis le reporter dans `.env`. **Ne jamais copier `.env` sur GitHub.** En cas d'incompatibilité Docker Compose sur la version QNAP, utiliser Container Station avec le fichier Compose et vérifier les chemins/permissions. L'application Docker expose uniquement `127.0.0.1:8787` côté hôte.

## 2. HTTPS

Configurer une adresse HTTPS accessible depuis l'extérieur, terminée par un reverse proxy sécurisé, pointant vers `127.0.0.1:8787`. Vérifier TLS et CORS depuis l'origine `https://sicho95.github.io`. Ne pas exposer directement l'API SQLite ou les fichiers de volume. La PWA GitHub Pages en HTTPS n'accepte pas un backend HTTP privé depuis Internet.

## 3. Vérifications avant activation

1. `GET /health` sur l'URL publique HTTPS : `status=ok`.
2. Créer un profil test sur une version candidate servie en contexte sécurisé, confirmer un deuxième appareil et vérifier que les portefeuilles réels ne sont pas écrasés.
3. Sur 2 appareils, modifier deux réglages différents : synchronisation sans conflit ; modifier le même stop sur les deux hors ligne : conflit détecté, jamais fusion silencieuse.
4. Créer **deux profils distincts** (ex. Damien/Jean) et vérifier l'absence de fuite entre leurs appareils et leurs alertes.
5. Activer les notifications sur PWA Home Screen iOS, souscrire PushManager avec la clé NAS et tester une vraie réception pendant que la PWA est fermée. La notification locale générée par rafraîchissement n'est pas suffisante.
6. Simuler un événement de stop avec un jeu **fictif** en environnement de test (ne pas altérer les seuils réels en production) ; vérifier événement unique, réarmement et lien depuis la notification.
7. Contrôler les sources OKSURF/Yahoo/GDELT/RSS, la latence et le filtrage actualités en production ; les API non officielles peuvent échouer et doivent rester optionnelles.

## 4. Sauvegarde / reprise

- Sauvegarder la PWA via export JSON avant la première synchronisation et avant tout merge vers `main`.
- La base se trouve dans `worker/state/alphaterminal.sqlite3` ; la clé VAPID dans `worker/state/vapid_private.pem`. Arrêter le conteneur pour faire une copie cohérente (ou utiliser la méthode backup SQLite) ; sauvegarder les deux et protéger par permissions.
- Un rollback frontend v1.0.0 conserve les clés `alphaTerm_*` et les portefeuilles sur iPhone. Ne pas désinstaller la PWA ni purger les données Safari.
- Une perte des clés VAPID impose potentiellement un nouvel abonnement Push sur chaque appareil.

## 5. Limites

Aucun test de build Docker QNAP et aucune notification distante Safari iOS réelle n'ont été exécutés dans l'environnement de développement de ce lot. Le reverse proxy peut requérir des réglages supplémentaires selon QTS et réseau. Ne pas promettre une surveillance de marché continue tant que les services et alertes ne sont pas testés de bout en bout.
