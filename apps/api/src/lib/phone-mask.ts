/**
 * phone-mask (API) — masquage PII d'un numéro de téléphone (CONTRACT-007).
 *
 * LA LOI (NOTIF-002 / CONTRACT-007) : un numéro n'est JAMAIS exposé en clair hors
 * de l'appel adaptateur. Seul `phoneNumberMasked` (calculé serveur) peut apparaître
 * en réponse API ou en log : **2 premiers + 2 derniers chiffres visibles**, groupes
 * intermédiaires remplacés par `••`, groupés par 2 (ex. `07 •• •• •• 47`).
 *
 * @module
 */

/** Séparateur de groupe masqué (2 caractères, non ambigu). */
const MASK_GROUP = "••" as const;

/**
 * Masque un numéro de téléphone (E.164 ou brut) selon la règle CONTRACT-007.
 *
 * Seuls les chiffres sont considérés (le `+` et les séparateurs sont ignorés).
 * Les 2 premiers et 2 derniers chiffres restent visibles ; les chiffres du milieu
 * sont remplacés par des groupes `••` de 2 caractères. Un numéro trop court pour
 * exposer 4 chiffres distincts est intégralement masqué (aucune fuite partielle).
 *
 * @param phone - Numéro brut ou E.164 (ex. `+2250700000047`)
 * @returns Numéro masqué (ex. `07 •• •• •• 47`)
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Trop court pour révéler 4 chiffres distincts (2 tête + 2 queue) : tout masquer.
  if (digits.length < 5) {
    return MASK_GROUP;
  }
  const head = digits.slice(0, 2);
  const tail = digits.slice(-2);
  const middleCount = digits.length - 4;
  // Un groupe `••` par tranche de 2 chiffres masqués (arrondi supérieur).
  const groups = Math.ceil(middleCount / 2);
  const middle = Array.from({ length: groups }, () => MASK_GROUP).join(" ");
  return `${head} ${middle} ${tail}`;
}
