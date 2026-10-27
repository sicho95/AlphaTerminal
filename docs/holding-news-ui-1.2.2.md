## Actualités des titres détenus — AlphaTerminal 1.2.2

**À distinguer de Signaux → Macro/géopolitique.** Cette section d'Analyse est dédiée à la presse concernant les **sociétés, émetteurs d'ETF et fonds réellement en position** dans le périmètre sélectionné. Les positions de quantité nulle et les liquidités ne déclenchent pas de recherche. Ce ne sont pas les alertes Web Push macro.

**Interface :** Analyse → News titres ; choix « Tous les titres détenus » ou d'une position particulière, 7 ou 30 derniers jours, et lecture des liens avec date, source et nom de la ligne. Les six positions de plus grande valeur sont interrogées en premier, puis « Rechercher aussi parmi les autres titres » étend la recherche ; cette limite évite 100 requêtes simultanées lorsque le profil possède de nombreuses lignes.

**Moteurs :** en suivi NAS, `GET /api/v1/holdings/news?days=7|30&position_id=...&portfolio_ids=...&offset=...` ; authentification obligatoire par jeton d'appareil, noms/ISIN/tickers tirés exclusivement du profil NAS (les clients ne transmettent aucun texte libre à faire rechercher). Trois fournisseurs publics ciblés par nom/ISIN/ticker : Google Actualités (RSS), Yahoo Finance (recherche titres) et GDELT. En mode local, les mêmes catégories sont essayées par le navigateur via le proxy CORS configuré. Des indisponibilités réseau/API peuvent produire un résultat incomplet et sont signalées.

**Performance :** cache NAS `holding_news_cache` sur 20 minutes par profil/titre/période, appels externes bornés, pagination six positions. Les données ajoutées à SQLite sont indépendantes des stops, portefeuilles et secrets NAS ; suppression des profils nettoie ce cache. Recette réelle iOS et sources en direct à vérifier après déploiement.

**Design :** présentation à intercalaires, sans titre de section ni cadre répétitif. Le panneau d'alertes sépare son défilement de celui de la page et utilise un format date/texte plus compact.

**Attention :** Yahoo Finance Search est une API non officielle, GDELT et Google peuvent limiter les recherches ; AlphaTerminal ne peut pas garantir un résultat exhaustif ou un même volume d'articles que Fortuneo, qui dispose de fournisseurs sous licence. Un état vide peut indiquer une absence d'article trouvé *par les sources interrogées*, pas une absence de nouvelles dans le monde.
