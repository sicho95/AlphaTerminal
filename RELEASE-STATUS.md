# Statut de publication

- **Production GitHub vérifiée avant ces travaux : v1.0.0**.
- **Ce ZIP : candidat 1.1.0** développé en environnement local isolé.
- Tests automatisés localement : à consulter dans `tests/` et `worker/tests/`.
- Aucun `git push`, aucune release GitHub 1.1.0, aucun NAS configuré depuis cette session.
- Avant déploiement : sauvegarde des données de la PWA (export JSON), sauvegarde des clés VAPID et SQLite, tests Safari iOS et HTTPS.

# État réel de livraison

Livraison : sources v1.0.0 **prêtes à tester et publier**, mais pas encore publiées.

Pour publier depuis un Mac possédant Git et le CLI `gh` connecté :

```sh
cd ~/Downloads/AlphaTerminal-v1.0.0
bash scripts/publish-github.sh
```

Après activation de GitHub Pages et vérification de la PWA iOS sur `/AlphaTerminal/index.html`, le script de suppression distinct est disponible :

```sh
bash scripts/delete-alphaterminal2.sh
```

La suppression **n'est jamais lancée automatiquement** lors de la création du site, même si l'utilisateur a donné son accord initial : l'étape destructrice exige de constater le succès de la migration et d'enregistrer un miroir du dépôt AlphaTerminal2.

Pré-requis : `brew install gh` puis `gh auth login` si `gh` est absent. La suppression nécessite des autorisations supplémentaires GitHub (`delete_repo`).
