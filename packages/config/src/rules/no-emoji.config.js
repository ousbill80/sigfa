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
 * Exemption TEMPORAIRE (sous-chaînes de chemin).
 *
 * TODO: lever après migration icônes kiosk — la piste parallèle
 * `feat/kiosk-icons-sigfa` purge en ce moment même les emojis de `apps/kiosk`
 * (remplacement par le set SigfaIcon de @sigfa/ui, cf. ICONS-001).
 * L'exemption sera retirée dans un commit suivant, une fois cette migration
 * mergée. Toutes les autres zones (api, web, ui, schemas, contracts,
 * database, factories, testing, tools) sont soumises à la règle.
 */
export const TEMP_NO_EMOJI_EXEMPT_PATHS = ["apps/kiosk/"];

/** Options de la règle, partagées entre les deux blocs de config. */
const NO_EMOJI_RULE_ENTRY = [
  "error",
  { ignorePaths: TEMP_NO_EMOJI_EXEMPT_PATHS },
];

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
