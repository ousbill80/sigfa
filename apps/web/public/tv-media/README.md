# Médias de l'écran TV d'agence (`/tv/[agencyId]`)

La grande zone gauche de l'écran TV diffuse en boucle les médias décrits par
`manifest.json` (ce dossier), avec fondu croisé ~400 ms entre chaque média
(désactivé si le spectateur préfère `prefers-reduced-motion`).

## Format du manifeste

Tableau JSON d'entrées :

```json
[
  { "type": "image", "src": "/tv-media/promo-epargne.svg", "durationMs": 8000 },
  { "type": "video", "src": "/tv-media/demo-clip.mp4" }
]
```

- `type` : `"image"` ou `"video"`.
- `src` : chemin local servi depuis `apps/web/public/` (ex. `/tv-media/...`)
  ou URL absolue (CDN de la banque).
- `durationMs` (optionnel) : durée d'affichage en ms.
  - Image : défaut **8000 ms**.
  - Vidéo : lue `muted autoplay playsinline`, avance à la **fin de lecture** ;
    si `durationMs` est fourni, il borne l'affichage.

Comportement : boucle infinie, préchargement du média suivant, un média en
échec de chargement est **sauté** proprement. Les entrées invalides sont
filtrées une à une.

## Repli (zéro régression)

Sans manifeste, manifeste invalide, playlist vide ou tous médias en échec →
l'écran retombe sur les slides promo **texte** existantes (« Crédit auto… »).
Aucun asset n'est jamais requis.

## Surcharge par environnement

`NEXT_PUBLIC_TV_MEDIA_MANIFEST_URL` (voir `.env.example`) remplace l'URL du
manifeste (ex. manifeste hébergé par la banque). Inlinée au build Next.

## Couture à venir (console admin)

Ce manifeste statique est provisoire : le pilotage des médias par la console
admin (upload banque, planification) le remplacera — la couture est le module
`src/lib/tv-media.ts` (types + parsing) ; seule la source de l'URL changera.

Les fichiers `promo-*.svg` et `demo-clip.mp4` sont des médias de démonstration
générés localement (libres de droits) pour visualiser le défilement.
