/**
 * Parseur ESLint « texte brut » — permet d'appliquer `sigfa/no-emoji` aux
 * fichiers JSON de messages (i18n) sans dépendance supplémentaire.
 *
 * Il produit un Program ESTree vide : aucune règle AST classique n'a de nœud à
 * visiter (donc aucun faux positif des règles recommandées), mais
 * `sourceCode.text` reste le contenu complet du fichier — exactement ce que
 * scanne `sigfa/no-emoji` sur son écouteur `Program`.
 *
 * @module rules/plain-text-parser
 */

/**
 * @param {string} text - Contenu brut du fichier.
 * @returns {{ ast: object }} Résultat de parse minimal accepté par ESLint.
 */
export function parseForESLint(text) {
  const lines = text.split("\n");
  return {
    ast: {
      type: "Program",
      body: [],
      sourceType: "module",
      comments: [],
      tokens: [],
      range: [0, text.length],
      loc: {
        start: { line: 1, column: 0 },
        end: { line: lines.length, column: lines[lines.length - 1].length },
      },
    },
  };
}

/** Parseur au format objet attendu par `languageOptions.parser` (flat config). */
export const plainTextParser = {
  meta: { name: "@sigfa/plain-text-parser", version: "1.0.0" },
  parseForESLint,
};
