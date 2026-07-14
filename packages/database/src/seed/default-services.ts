/**
 * Catalogue de services par défaut SIGFA — DB-003
 *
 * Source : v5 §MODULE 1 — Types de services pré-configurés (modifiables par banque).
 * Ce catalogue est une constante versionnée : il n'existe PAS de table plateforme
 * pour le catalogue ; il est inséré à la création d'une banque de démo (SEED_DEMO)
 * et cloneable par la banque via l'API (API-009 — hors scope F2).
 *
 * ATTENTION — SLA en GABARIT BANQUE : ces valeurs sont les défauts recommandés.
 *    Chaque banque peut les personnaliser après onboarding.
 *
 * @module
 */

/**
 * Entrée du catalogue de services par défaut.
 */
export interface DefaultService {
  /** Code mnémotechnique 2–4 lettres majuscules (ex : "OC"). */
  code: string;
  /** Libellé du service en français. */
  name: string;
  /** SLA cible en minutes (LA LOI v5 §MODULE 1 — valeurs exactes). */
  slaMinutes: number;
  /** Ordre d'affichage recommandé (0-based). */
  displayOrder: number;
}

/**
 * Catalogue de 8 services par défaut SIGFA, codes et SLA exacts (LA LOI v5 §MODULE 1).
 *
 * | Code | Service                               | SLA |
 * |------|---------------------------------------|-----|
 * | OC   | Opérations courantes                  | 15  |
 * | OA   | Ouverture de compte                   | 30  |
 * | CR   | Crédits & financements                | 45  |
 * | CH   | Change de devises                     | 10  |
 * | EN   | Service entreprises / Corporate       | 45  |
 * | VIP  | Private Banking / Espace VIP          | 20  |
 * | RE   | Réclamations & litiges                | 30  |
 * | EP   | Épargne & placements                  | 25  |
 */
export const DEFAULT_SERVICES: ReadonlyArray<DefaultService> = [
  {
    code: "OC",
    name: "Opérations courantes",
    slaMinutes: 15,
    displayOrder: 0,
  },
  {
    code: "OA",
    name: "Ouverture de compte",
    slaMinutes: 30,
    displayOrder: 1,
  },
  {
    code: "CR",
    name: "Crédits & financements",
    slaMinutes: 45,
    displayOrder: 2,
  },
  {
    code: "CH",
    name: "Change de devises",
    slaMinutes: 10,
    displayOrder: 3,
  },
  {
    code: "EN",
    name: "Service entreprises / Corporate",
    slaMinutes: 45,
    displayOrder: 4,
  },
  {
    code: "VIP",
    name: "Private Banking / Espace VIP",
    slaMinutes: 20,
    displayOrder: 5,
  },
  {
    code: "RE",
    name: "Réclamations & litiges",
    slaMinutes: 30,
    displayOrder: 6,
  },
  {
    code: "EP",
    name: "Épargne & placements",
    slaMinutes: 25,
    displayOrder: 7,
  },
] as const;
