/**
 * KIOSK-001 — postcss.config.mjs
 *
 * Le kiosque n'utilise AUCUNE directive Tailwind (`@tailwind`/`@apply`) : ses
 * écrans sont stylés en inline + variables CSS du design system `@sigfa/ui`
 * (tokens.css / components.css sont du CSS standard). On n'exécute donc aucun
 * plugin PostCSS — la CSS passe telle quelle. (Retrait de `@tailwindcss/postcss`
 * qui n'était pas installé et faisait échouer `next build` dès l'import CSS.)
 */
const config = {
  plugins: {},
};

export default config;
