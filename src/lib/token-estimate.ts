/**
 * Fast heuristic token estimator: chars/4 with a mild bump for code fences and
 * table rows, which tokenize denser than prose. Deliberately avoids a real
 * tokenizer/BPE table to keep the dependency footprint and slop-gate surface
 * small (see Cursidian Improvement Plan, Appendix B, tokenizer fidelity).
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  const base = Math.ceil(text.length / 4);
  const codeFenceLines = text.match(/^```/gm)?.length ?? 0;
  const tableRows = text.match(/^\s*\|.*\|\s*$/gm)?.length ?? 0;
  const bump = Math.ceil(codeFenceLines * 2 + tableRows * 0.5);

  return base + bump;
}

/**
 * Sums estimated tokens across multiple text fragments.
 */
export function estimateTokensTotal(texts: string[]): number {
  return texts.reduce((sum, text) => sum + estimateTokens(text), 0);
}
