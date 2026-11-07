# Mon carnet

Carnet de notes journalier installable, stocké localement dans le navigateur.

## Déploiement avec les transferts

Le transfert inter-appareils utilise un Cloudflare Worker et un Durable Object
SQLite pour garantir qu’un code aléatoire ne puisse être consommé qu’une fois.
Les notes associées au code sont automatiquement supprimées à son expiration
(24 heures après sa création).

1. Installer Node.js et créer un compte Cloudflare.
2. À la racine du projet, exécuter `npx wrangler login`.
3. Déployer l’application et son API avec `npx wrangler deploy`.
4. Ouvrir l’URL `workers.dev` indiquée par Wrangler sur les deux appareils.

Les notes restent dans le stockage local du navigateur sauf pendant un transfert.
La création d’un code envoie une copie des notes à Cloudflare, où elle est
conservée au maximum 24 heures. L’import fusionne les notes et remplace les notes
locales portant les mêmes dates. Il n’importe pas les préférences d’affichage.

L’application doit être servie en HTTPS pour être installable et pour que le
service worker fonctionne.
