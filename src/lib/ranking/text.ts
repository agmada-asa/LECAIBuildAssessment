/** @file Shared text normalisation and overlap helpers for deterministic ranking. */

/** Canonicalises source text for deterministic phrase and token comparisons. */
export function normaliseText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns meaningful lowercase tokens while discarding two-character noise. */
function tokenise(value: string): Set<string> {
  return new Set(
    normaliseText(value)
      .split(" ")
      .filter((token) => token.length > 2),
  );
}

/** Measures overlap against the smaller token set so short phrases can match. */
export function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokenise(left);
  const rightTokens = tokenise(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });

  return intersection / Math.min(leftTokens.size, rightTokens.size);
}
