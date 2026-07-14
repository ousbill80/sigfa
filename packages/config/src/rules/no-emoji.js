/**
 * Règle ESLint locale `sigfa/no-emoji` — exigence PO : « n'utilise jamais d'émoticône ».
 *
 * Interdit tout caractère emoji / pictographique dans le texte source
 * (littéraux, templates, JSX, commentaires, JSON de messages) :
 *   - U+1F000–U+1FAFF : emojis, symboles picturaux, drapeaux régionaux
 *     (U+1F1E6–U+1F1FF inclus dans la plage) ;
 *   - U+2600–U+27BF  : symboles divers + dingbats (inclut U+2713 « coche »,
 *     U+26A0 « attention », U+2705, U+274C, U+2605 « étoile ») ;
 *   - U+2B00–U+2BFF  : flèches et symboles divers (inclut U+2B05, U+2B50) ;
 *   - U+FE0F         : sélecteur de variante emoji.
 *
 * NE flague PAS les caractères français légitimes : accents, « », ·, –, —, …,
 * ni les flèches U+2190–U+21FF (ex. →), ni les traits de boîte U+2500–U+257F,
 * ni les séquences d'échappement (`\u{1F600}` en source reste autorisé, p. ex.
 * dans une regex de nettoyage).
 *
 * La détection se fait sur le texte source brut (sourceCode.text) : elle couvre
 * donc uniformément littéraux de chaîne, templates, JSXText, commentaires et
 * fichiers JSON de messages (via le parseur texte-brut du package).
 *
 * @module rules/no-emoji
 */

/** Plages interdites (voir en-tête). Flag `u` obligatoire pour U+1F000+. */
const EMOJI_PATTERN =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

/** @type {import("eslint").Rule.RuleModule} */
export const noEmojiRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Interdit les caractères emoji/pictographiques dans les sources (exigence PO SIGFA).",
    },
    schema: [
      {
        type: "object",
        properties: {
          ignorePaths: {
            type: "array",
            items: { type: "string" },
            description:
              "Sous-chaînes de chemin (séparateur /) exemptées de la règle.",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden:
        "Émoticône/pictogramme U+{{code}} interdit — exigence PO « n'utilise jamais d'émoticône ». " +
        "Pour une icône d'interface, utilisez SigfaIcon de @sigfa/ui (ex. U+2713 → <SigfaIcon name=\"valider\" />) ; " +
        "dans du texte, des logs ou des commentaires, remplacez par du texte ([OK], [NON], ATTENTION…).",
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    /** @type {string[]} */
    const ignorePaths = options.ignorePaths ?? [];
    const filename = context.filename.replace(/\\/g, "/");

    if (ignorePaths.some((fragment) => filename.includes(fragment))) {
      return {};
    }

    return {
      Program() {
        const sourceCode = context.sourceCode;
        const text = sourceCode.text;
        for (const match of text.matchAll(EMOJI_PATTERN)) {
          const char = match[0];
          const index = match.index;
          const code = char
            .codePointAt(0)
            .toString(16)
            .toUpperCase()
            .padStart(4, "0");
          context.report({
            loc: {
              start: sourceCode.getLocFromIndex(index),
              end: sourceCode.getLocFromIndex(index + char.length),
            },
            messageId: "forbidden",
            data: { code },
          });
        }
      },
    };
  },
};

/** Plugin local — consommé par eslint.config.js du package. */
export const sigfaPlugin = {
  meta: { name: "@sigfa/eslint-plugin-local", version: "1.0.0" },
  rules: { "no-emoji": noEmojiRule },
};
