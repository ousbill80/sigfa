/**
 * Générateur de nombres pseudo-aléatoires Mulberry32.
 * Déterministe : même graine → même séquence.
 * @param seed - Graine entière (défaut 0)
 * @returns Fonction next() retournant un float dans [0, 1)
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
