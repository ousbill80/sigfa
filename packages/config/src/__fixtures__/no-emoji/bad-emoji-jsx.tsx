// Fixture : texte JSX contenant une coche U+2713 — doit être flagué.
export function Done(): unknown {
  return <span aria-hidden="true">✓</span>;
}
