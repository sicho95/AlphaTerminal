# AlphaTerminal uniquement : GitHub → miroir Forgejo → Docker QNAP

**Périmètre strict.** La procédure ne parcourt jamais les dépôts GitHub ni les dépôts Forgejo ; elle crée/consulte uniquement `sicho95/AlphaTerminal` ↔ `<FORGEJO_USER>/AlphaTerminal`. Elle ne touche jamais à Home Assistant, Portainer, SichoBooks, SichoBrain ou aux autres conteneurs.

## 1. Publication GitHub, en préproduction

Le ZIP contient l'intégralité de la PWA et du worker Python sous `worker/`.

Depuis un Mac avec GitHub CLI (`gh`), après sauvegarde de la PWA iPhone, ouvrir le projet extrait :

```bash
cd ~/Downloads/AlphaTerminal-v1.1.0-CANDIDAT
bash scripts/publish-v1.1.0.sh
```

Ce script crée **la branche `feature/worker-v1.1.0` et une PR**, pas une nouvelle release GitHub Pages. La branche `main` de l'application iOS en service (1.0.0) n'est pas modifiée. Ne fusionner qu'après tests réels.

## 2. Créer UN miroir GitHub → Forgejo

Le dépôt cible doit **ne pas exister** ; le script refusera sinon, sans écrasement.

Depuis le Mac (en évitant d'enregistrer le jeton dans le shell/history) :

```bash
export FORGEJO_URL='https://ADRESSE-DE-TON-FORGEJO'  # ou http://nas-damien:PORT via Tailscale avec autorisation explicite
export FORGEJO_USER='NOM-DU-COMPTE-FORGEJO'
read -rs FORGEJO_TOKEN; echo; export FORGEJO_TOKEN
AT_DRY_RUN=1 bash scripts/mirror-alpha-to-forgejo.sh   # contrôle, sans création
bash scripts/mirror-alpha-to-forgejo.sh
unset FORGEJO_TOKEN
```

Si ton Forgejo actuel n'a que `http://nas-damien:PORT` via le tunnel Tailscale privé, définir `FORGEJO_ALLOW_TAILNET_HTTP=1` dans ce terminal avant le script ; le chiffrement est alors fourni par Tailscale et non par HTTP lui-même. Pour une exposition au-delà du tailnet, HTTPS reste obligatoire.

Le script utilise `POST /api/v1/repos/migrate` avec `mirror: true` et `service: git` pour **le seul dépôt**. Il n'essaie pas de copier tous les dépôts GitHub ou de toucher aux autres projets Forgejo.

Sur Forgejo : vérifier le miroir `AlphaTerminal`, sa branche `main`, puis éventuellement « Synchronize Now ». Le miroir en lecture seule se met à jour périodiquement (intervalle demandé : 10 min ; l'administrateur peut imposer une limite). Une synchronisation miroir ne copie pas nécessairement tickets, PR et fichiers de release hébergés séparément : la source de code reste GitHub.

## 3. Préparer un dossier NAS dédié

**Ne pas réutiliser un dossier d'autres conteneurs ni l'arborescence interne de Forgejo.** Choisir un emplacement du NAS et remplacer les chemins ci-dessous :

```bash
export AT_DEPLOY_HOME='/share/CE_CACHEDEV1_DATA/Container/AlphaTerminal'  # volume NAS-DAMIEN connu ; sous-dossier à créer
export AT_FORGEJO_GIT_URL='ssh://git@FORGEJO-HOTE:PORT/UTILISATEUR/AlphaTerminal.git'
mkdir -p "$AT_DEPLOY_HOME/config" "$AT_DEPLOY_HOME/data"
# les données de profil, la BDD SQLite et les clés VAPID vivront ici durablement
# le conteneur Docker tourne comme UID 10001 : appliquer les droits adaptés depuis une session admin
sudo chown -R 10001:10001 "$AT_DEPLOY_HOME/data"
chmod 700 "$AT_DEPLOY_HOME/data"
```

Copier l'exemple `worker/.env.example` vers `$AT_DEPLOY_HOME/config/worker.env`. Définir :

```dotenv
AT_HOST_DATA_DIR=/share/CE_CACHEDEV1_DATA/Container/AlphaTerminal/data
AT_BOOTSTRAP_CODE=<SECRÉT_ALÉATOIRE_LONG_À_GÉNÉRER>
AT_VAPID_SUBJECT=mailto:adresse-de-contact@exemple.fr
```

Protéger le fichier avec `chmod 600`. Ne pas le versionner. Le jeton Forgejo n'est pas à placer dans le fichier du worker ; le NAS peut utiliser une **clé SSH de lecture seule** dédiée à ce dépôt miroir.

Installer le script depuis l'archive dans un emplacement persistant sur le NAS (hors des releases), par exemple `$AT_DEPLOY_HOME/bin/deploy-from-forgejo.sh`, puis :

```bash
export AT_AUTO_DEPLOY=0
bash "$AT_DEPLOY_HOME/bin/deploy-from-forgejo.sh"  # récupération Git + validation, PAS de démarrage
# après validation de la configuration et choix de la branche main comme canal stable
AT_AUTO_DEPLOY=1 bash "$AT_DEPLOY_HOME/bin/deploy-from-forgejo.sh"
curl -fsS http://127.0.0.1:18878/health
```

La version déployée provient **uniquement de `main` sur le miroir AlphaTerminal**. Une modification sur une branche candidate ne déploie rien. Le script ne lance `docker compose -p alphaterminal ... up -d` que si l'arbre `worker/` a changé : modifier un README ou les fichiers CSS seuls ne reconstruit pas le conteneur. Aucun `docker system prune` ni commande Docker globale. En cas d'échec du conteneur ou du contrôle de santé, tentative de retour à la release antérieure. Les données restent dans `$AT_HOST_DATA_DIR`.

### Automatisation ciblée

Après les essais, configurer **une seule tâche planifiée QNAP** exécutant toutes les 5 ou 10 minutes :

```bash
AT_DEPLOY_HOME='/chemin/ABSOLU/AlphaTerminal' AT_FORGEJO_GIT_URL='ssh://git@FORGEJO-HOTE:PORT/UTILISATEUR/AlphaTerminal.git' AT_AUTO_DEPLOY=1 /chemin/ABSOLU/AlphaTerminal/bin/deploy-from-forgejo.sh >> /chemin/ABSOLU/AlphaTerminal/logs/deploy.log 2>&1
```

Cette commande s'ajoute à la planification QNAP ; ne pas remplacer la crontab existante. Les modifications `main` de GitHub parviennent au miroir Forgejo après son cycle de synchronisation, puis au déploiement après la prochaine vérification QNAP. **Ce n'est pas instantané** ; choisir un webhook isolé ou un Forgejo Runner configuré ultérieurement si nécessaire. Les autres projets ne sont jamais surveillés.

## 4. HTTPS Tailscale : cohabitation avec les routes actuelles

La PWA publique est sur `https://sicho95.github.io/AlphaTerminal/`. Le backend ne doit pas être accessible en HTTP sur un autre appareil. MagicDNS résout le nom mais **ne suffit pas pour HTTPS**.

Si le démon Tailscale `tailscaled` fonctionne directement sur le NAS/hôte Docker, examiner avant tout :

```bash
tailscale status
tailscale serve status
# Ne surtout pas utiliser "tailscale serve reset" (effacerait des routes Serve existantes).
```

Si le port HTTPS 8443 est libre dans **Tailscale Serve** :

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:18878
tailscale serve status
```

Tailscale crée un certificat valide pour son FQDN `*.ts.net` après activation des certificats HTTPS dans le tailnet. Dans AlphaTerminal, renseigner l'URL **réelle affichée** par `tailscale serve status`, avec `:8443` si applicable. Ne pas inventer le nom du domaine tailnet. Choisir un autre port ou montage de chemin si 8443 est déjà utilisé et tester la compatibilité de la version Tailscale installée. **Ne pas employer `tailscale funnel`** sauf décision explicite d'ouvrir au public.

Si Tailscale est uniquement dans un conteneur distinct, `127.0.0.1:18878` pointe vers ce conteneur et non vers l'hôte QNAP : adapter le routage (reverse proxy local, réseau partagé ou instance Serve sur l'hôte), après inspection de l'installation existante. Le script ne modifie pas ces routes.

**Les iPhone et Mac doivent appartenir au tailnet pour accéder à cette API privée**. Ton père devra disposer d'un accès Tailscale autorisé pour appairage/synchronisation hors du Wi-Fi. Le NAS peut néanmoins pousser vers les serveurs Apple depuis Internet, même si le téléphone n'a pas de tunnel actif au moment de la réception. Une URL HTTPS publique via un proxy correctement sécurisé peut être envisagée plus tard si tu ne veux pas installer Tailscale sur tous les appareils.

## 5. Validation de production

1. Exports JSON sur iPhone + Mac ; base SQLite et clé VAPID dans un volume persistant externe au dépôt.
2. Branches staging GitHub/Forgejo, tests Node/Python, puis profils **fictifs**.
3. Recette autorisation nouvel appareil, synchronisation concurrente, révocation, récupération offline, deux profils séparés.
4. Test Web Push **lorsque la PWA iOS est fermée**, via vrai serveur NAS, ainsi que retour dans le centre de notification.
5. Vérifier actualités (liens et classifications), impact ETF sans faux positifs, charge NAS et alerte de données périmées.
6. Fusion vers `main`, déploiement automatique du worker, puis publication de release v1.1.0. Aucun écrasement du stockage Safari.

## 6. Limites connues

- Le serveur n'a pas été construit/testé dans Docker sur ce QNAP dans le présent environnement ; il faut valider permissions QTS et réseau Docker.
- Les endpoints Yahoo Finance et certains flux RSS sont externes et peuvent changer, ne constituent pas une garantie de cotation en temps réel.
- Forgejo « pull mirror » est en lecture seule ; les changements en direct doivent aller sur GitHub ou sur une branche hors miroir.


## Correctif QNAP 26/10/2026 — routes existantes

La sortie réelle `tailscale serve status` du NAS confirme **Funnel on** sur `https://nas-damien.tailfb6907.ts.net` : `/` → Home Assistant :8123, `/git` → Forgejo :3000, `/agent` → SichoAgent :18765, `/livres` → SichoBooks :8787, `/portainer` → Portainer :9443. **Ne jamais modifier ni réinitialiser ces routes à l'aveugle.** Funnel, contrairement à Serve privé, permet des accès depuis Internet ; utiliser une exposition privée du worker dans un premier temps et auditer les accès des services existants.

**La valeur par défaut est maintenant `AT_HOST_PORT=18878`.** Compose expose uniquement `127.0.0.1:${AT_HOST_PORT:-18878}:8080` ; les vérifications de santé du script pointent vers ce même port. Avant tout démarrage, vérifier `netstat -tln 2>/dev/null | grep ':18878 '` et `docker ps`. L'ancienne archive/ancien script téléchargé avant ce correctif utilisent `8787` : **retélécharger la branche candidate** ou modifier explicitement les anciennes copies.

La version exacte du client Tailscale QNAP doit être vérifiée via `<CHEMIN_BINAIRE_TAILSCALE> version` avant d'utiliser les syntaxes CLI récentes `--bg --https=8443`; les commandes Serve ont changé en 1.52. Tailscale 8443 serait une nouvelle entrée **Serve privée**, à envisager si elle est libre et si tous les appareils ont Tailscale. **Ne pas ajouter /alpha à Funnel public avant audit de sécurité et essais d'authentification.**

Sur ce QNAP, `docker compose version` = 2.29.1-qnap2, mais `git --version` échoue (commande absente du PATH). Le script de déploiement exige Git sur le NAS : installer/repérer Git (Entware/QGit) ou utiliser un conteneur utilitaire isolé avant l'automatisation. La présence du répertoire téléchargé ne signifie pas que le worker est déployé. `main` GitHub est encore en 1.0.0 ; le script de déploiement ne doit pas être activé tant que `main` ne contient pas la version testée.


### Option ultérieure — même domaine, chemin `/alphaterm` (à ne pas activer maintenant)

L'utilisateur souhaite éventuellement utiliser `https://nas-damien.tailfb6907.ts.net/alphaterm` comme URL API, à côté de `/git`, `/livres`, `/agent` et `/portainer`. Le backend continue d'écouter **exclusivement `127.0.0.1:18878`**, le reverse proxy Tailscale ajoute seulement le chemin public `/alphaterm` vers ce port. La version PWA reste sur GitHub Pages : on ne déplace pas la PWA elle-même.

**Important : le port HTTPS 443 du NAS est aujourd'hui en Tailscale Funnel public**. Monter `/alphaterm` sur ce port publierait l'API vers Internet. Exiger l'authentification par appareil, limites de taux, tests d'appairage/revocation, gestion des secrets, et ne pas publier sans recette. Tester la réécriture du préfixe `/alphaterm` par Tailscale avant d'inscrire l'URL dans la PWA. Selon le proxy, les routes `/api/v1/...` de FastAPI doivent recevoir les requêtes sans le préfixe ; les URLs générées et redirections doivent rester cohérentes. Vérifier le support CLI `--set-path` de la version QPKG avant toute commande. Ne jamais utiliser `tailscale serve reset`, ne jamais écraser les routes existantes.

Pour les premières recettes, préférer **un HTTPS Serve privé distinct** sur un port disponible, après vérification `tailscale serve status` et de la version du CLI. Le chemin public `/alphaterm` sera une décision d'activation de production séparée.
