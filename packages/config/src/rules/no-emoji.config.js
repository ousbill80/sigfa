/**
 * Fragment de flat config activant `sigfa/no-emoji` sur tout le monorepo :
 *   - fichiers source .ts/.tsx/.js/.jsx/.mjs/.cjs (via la config partagée) ;
 *   - fichiers JSON de messages i18n (messages/, locales/, i18n/) via le
 *     parseur texte-brut local.
 *
 * Consommé par `@sigfa/config/eslint` (config partagée) et directement par
 * `apps/web/eslint.config.mjs` (qui n'étend pas la config partagée).
 *
 * @module rules/no-emoji.config
 */
import { sigfaPlugin } from "./no-emoji.js";
import { plainTextParser } from "./plain-text-parser.js";

/**
 * Sévérité de la règle, partagée entre les deux blocs de config.
 *
 * Aucune exemption de chemin : la règle s'applique à TOUT le monorepo
 * (l'exemption temporaire `apps/kiosk/` a été levée après la migration de la
 * borne vers le set SigfaIcon de @sigfa/ui, cf. ICONS-001).
 */
const NO_EMOJI_RULE_ENTRY = "error";

export const noEmojiConfigs = [
  // Tous les fichiers source JS/TS. Le motif `files` explicite garantit que
  // les .ts/.tsx sont bien appariés même dans une config qui n'étend pas la
  // base typescript-eslint (cas de apps/web : eslint.config.mjs autonome).
  {
    name: "sigfa/no-emoji/source",
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: { sigfa: sigfaPlugin },
    rules: { "sigfa/no-emoji": NO_EMOJI_RULE_ENTRY },
  },
  // Fichiers JSON de messages i18n — lintés grâce au parseur texte-brut.
  {
    name: "sigfa/no-emoji/messages-json",
    files: [
      "**/messages/**/*.json",
      "**/locales/**/*.json",
      "**/i18n/**/*.json",
    ],
    plugins: { sigfa: sigfaPlugin },
    languageOptions: { parser: plainTextParser },
    rules: { "sigfa/no-emoji": NO_EMOJI_RULE_ENTRY },
  },
];
