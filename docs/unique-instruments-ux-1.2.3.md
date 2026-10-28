# AlphaTerminal 1.2.3 — identité d'instrument, actualités titres et ergonomie mobile

## Choix fonctionnels
- **Une position n'est pas un instrument.** Une ligne PEA et une ligne CTO du même ISIN conservent chacune leur ID, PRU, quantité, horizon et règles de stop.
- L'instrument surveillé est partagé : ISIN en priorité, ticker Yahoo sinon. Les portefeuilles ayant le même titre peuvent donc partager la recherche d'actualités et un appel Yahoo pour un même ticker/cotation.
- Une saisie supplémentaire du même ISIN dans le **même portefeuille** met à jour la ligne existante, et une édition qui provoquerait un doublon est refusée. Il n'y a **pas de fusion destructive ni de migration** des données en place.
- Analyse → Lignes détenues affiche les titres distincts avec quantités/valeurs et PRU pondéré par quantités. Si plusieurs comptes détiennent un instrument, le détail PEA/CTO est dépliable : les lignes comptables ne disparaissent pas.
- Une combinaison d'ISIN explicitement incompatibles n'est pas fusionnée, même si le ticker paraît identique. Les frais, différentes monnaies de cotation et taux de change ne sont pas corrigés par une consolidation de convenance : vérifier les devises avant interprétation des valeurs.

## Actualités propres aux titres, pas à la macro
- Analyse → News titres n'est **pas** l'onglet Signaux → Macro/géopolitique.
- Le NAS et la PWA locale recherchent Google Actualités (RSS par nom/ISIN), Yahoo Finance (ticker) et GDELT (nom du titre).
- Le système vérifie au maximum six **instruments distincts** par page de recherches, avec cache NAS/local (20 min), un horizon par défaut de 30 jours, option sept jours, et **quatre derniers articles maximum par instrument**. L'article contient société, titre, source et date.
- Les nouvelles recherches NAS reprennent le même profil authentifié et les portefeuilles autorisés ; aucun profil extérieur n'est interrogé.
- En cas d'échec des fournisseurs, l'interface indique que l'absence de résultat **ne prouve pas** l'absence d'actualités.
- Les nouvelles clés de cache NES sont par instrument et non plus par ID de position. La base SQLite et les alertes existantes sont préservées.

## Interface
- Inventaire : **Structure puis Positions**, onglets intégrés au cadre commun.
- L'encart imbriqué « Données chargées » est remplacé par une ligne d'état compacte.
- La saisie d'une position propose une recherche Yahoo Finance par **nom, ticker ou ISIN** avec temporisation, limite de résultats, suggestions non exécutables, désactivation automatique en cas de réseau indisponible, et saisie manuelle toujours disponible. Vérifier l'ISIN lorsqu'il n'est pas transmis par Yahoo.
- Les intercalaires Signaux, Analyse, Inventaire et Paramètres ont déjà été harmonisés dans la 1.2.2 ; les en-têtes dupliqués ont été supprimés dans cette version. Le groupe des trois cartes Synthèse constitue l'exception utile.
- Notifications : titre et date sur une même ligne, source seulement si disponible, marge et espacements réduits ; le défilement interne et la sélection des notifications de la 1.2.2 sont conservés.

## Architecture et limites
- `js/instruments.js` et `worker/app/holding_news.py` définissent une clé d'instrument comparable (`isin:FR...` / `symbol:TICKER.PA`).
- `js/instrument-search.js` interroge Yahoo via le proxy HTTPS du profil utilisateur ; ne stocke aucun secret nouveau.
- `js/data.js` réutilise une cotation Yahoo déjà chargée **dans un cycle de rafraîchissement** pour les positions ayant les mêmes symboles et devise, sans mélanger leurs PRU.
- Des positions avec des seuils individuels peuvent toujours produire des alertes de risque distinctes ; mutualiser les nouvelles n'implique pas ignorer ces différences de risque.
- Le worker NAS conserve son API de news authentifiée, son historique, ses appareils et Web Push inchangés ; son numéro de version devient 1.2.3. Aucune mise à jour de schéma SQLite n'est nécessaire.
- CI GitHub Actions : syntaxe et tests Node, Python/FastAPI, construction/health Docker. La vérification de l'expérience réelle iPhone et des fournisseurs de presse reste un test sur l'appareil.

**Publication :** ne fusionner que lorsque CI est verte. Ne jamais effacer le stockage des PWA iPhone avant sauvegarde chiffrée vérifiée.
