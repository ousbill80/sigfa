// Fixture : caractères français légitimes — AUCUN ne doit être flagué.
// Guillemets « français », point médian ·, tirets – et —, points de suspension…
// Flèche → (U+2192) et traits de boîte ─── (U+2500) autorisés.
export const phrase =
  "L'agence « Abidjan-Plateau » a traité 12 tickets · durée moyenne – 4 min — voilà…";
export const fleche = "file d'attente → guichet";
// Une séquence d'échappement reste autorisée (ex. regex de nettoyage) :
export const nettoyeur = /[\u{1F000}-\u{1FAFF}]/gu;
