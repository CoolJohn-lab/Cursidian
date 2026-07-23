#!/usr/bin/env node
/**
 * Deprecated: decorative emoji is gated by EMOJI_RE in src/lib/slop.ts /
 * scripts/slop-lib.mjs, not by expanding .cursidian-slop.json char lists.
 */
console.error(
  'generate-emoji-rules.mjs is retired. Emoji stripping uses EMOJI_RE; do not reintroduce emoji codepoints into .cursidian-slop.json.',
);
process.exit(1);
