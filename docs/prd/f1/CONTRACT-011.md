# CONTRACT-011 : Amendement LA LOI — TicketPriority enum, Service.code, exemples display_number

**Module** : F1 — Contrats (amendement) · **Agent** : agent-contract · **Dépend de** : CONTRACT-010 (DONE) · **Statut** : TODO
**Origine** : Boucle 1 F2 — les critiques ont détecté que le contrat contredit le produit (v5 §MODULE 1 : 5 niveaux de priorité). Fenêtre pré-consommateurs (F3/F4 non démarrées) : breaking accepté et validé au GO F2.

## Exigences (EARS)
- core.yaml doit définir `components/schemas/TicketPriority` : enum `STANDARD | PRIORITY | VIP | PMR | SENIOR` (descriptions : file prioritaire guichet, VIP/private banking, personne à mobilité réduite, senior) et remplacer `priority: boolean` par `$ref TicketPriority` (défaut STANDARD) dans `CreateTicketRequest`, `Ticket`, `TicketSyncItem` et les schémas publics correspondants (public.yaml).
- Le schéma `Service` (core.yaml) doit gagner `code` : string 2–4 majuscules (`^[A-Z]{2,4}$`), unique par agence (documenté), exemples OC/OA/CR/CH/EN/VIP/RE/EP.
- Les exemples de `displayNumber` doivent suivre `{code}-{NNN}` (ex. `OC-047`) dans tous les fichiers concernés.
- Bundles + types + client régénérés synchrones ; tests structurels ajustés (TDD) ; spectral zéro erreur ; fumée Schemathesis verte.

## Critères d'acceptation
- [ ] `CONTRACT-011: TicketPriority enum 5 valeurs, priority boolean absent des 7 YAML (test d'inventaire)`
- [ ] `CONTRACT-011: Service.code pattern + exemples des 8 codes (test)`
- [ ] `CONTRACT-011: displayNumber exemples au format {code}-{NNN} partout (test)`
- [ ] `CONTRACT-011: generated/ resynchronisé, generate 2× zéro diff, 182+ tests verts, Schemathesis fumée verte`

## Hors scope
Toute autre évolution de contrat · implémentation des priorités (API-004).
