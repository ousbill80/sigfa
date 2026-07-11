# Sources — Jours fériés ivoiriens (CI)

## Sources officielles

- **Décret n°65-50 du 22 janvier 1965** : liste des jours fériés légaux en Côte d'Ivoire
- **Gouvernement de Côte d'Ivoire** : https://www.gouv.ci/
- **Direction générale du travail** : circulaires annuelles
- **IslamicFinder.org** : calcul des dates des fêtes islamiques (approximatives — croissant de lune)
- **Calendrier Hijri** : conversion pour les fêtes mobiles

## Fêtes fixes (is_approximate = false)

| Date (MM-DD) | Nom |
|---|---|
| 01-01 | Jour de l'An |
| 05-01 | Fête du Travail |
| 08-07 | Fête Nationale (Indépendance) |
| 11-01 | Toussaint |
| 11-15 | Fête Nationale (Paix) |
| 12-25 | Noël |
| 04-18 | Vendredi Saint (2025) |
| 04-21 | Lundi de Pâques (2025) |

> Les dates de Pâques sont calculées selon le calendrier grégorien (algorithme de Gauss).
> Elles sont connues à l'avance et insérées avec `is_approximate = false`.

## Fêtes mobiles islamiques (is_approximate = true)

Les dates des fêtes islamiques dépendent de l'observation du croissant de lune.
Elles sont donc **approximatives** (`is_approximate = true`) et doivent être confirmées
officiellement chaque année par les autorités religieuses ivoiriennes.

| Fête | Calendrier Hijri | Description |
|---|---|---|
| Maouloud (Mawlid) | 12 Rabi' al-Awwal | Naissance du Prophète |
| Tabaski (Aïd el-Kébir) | 10 Dhu al-Hijjah | Fête du Sacrifice |
| Ramadan (Aïd el-Fitr / Korité) | 1 Shawwal | Fin du Ramadan |
| Laylat al-Qadr / Assomption islamique | Variable | Nuit du destin |

## Mécanisme de mise à jour annuelle

**Story d'exploitation** : Créer un ticket annuel "Mettre à jour les fériés islamiques"
avant le 1er novembre de chaque année pour l'année N+1.

**Procédure** :
1. Consulter le calendrier islamique officiel pour l'année concernée
2. Mettre à jour les dates dans `src/seed/index.ts` (tableau `MOBILE_HOLIDAYS_YYYY`)
3. Régénérer le seed et relancer en production avec `pnpm --filter @sigfa/database seed`
4. Vérifier que le warning "année > max(year)" n'est plus émis

**Avertissement automatique** : Si `CURRENT_DATE > max(year)` parmi les fériés mobiles insérés,
le seed logge un warning au démarrage. Voir `checkHolidayWarning()` dans `src/seed/index.ts`.
