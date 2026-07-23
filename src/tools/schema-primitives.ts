import { z } from 'zod/v3';

/** Vault-relative note/folder path. */
export const boundedPath = z.string().min(1).max(500);

/** Manifest/vocabulary/project key-like string. */
export const boundedKey = z.string().min(1).max(200);

/** Revision or content hash (hex). */
export const boundedRevision = z.string().min(1).max(128);

/** Bounded string array for tool arguments. */
export function boundedStringArray(maxItems: number, maxLen = 200) {
  return z.array(z.string().min(1).max(maxLen)).max(maxItems);
}

/** Soft cap on JSON-serialized frontmatter string values. */
export const MAX_FRONTMATTER_VALUE_CHARS = 8_192;

/** Zod refine: reject frontmatter string values that are too large. */
export function refineFrontmatterValueSizes(obj: Record<string, unknown>): boolean {
  for (const value of Object.values(obj)) {
    if (typeof value === 'string' && value.length > MAX_FRONTMATTER_VALUE_CHARS) {
      return false;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.length > MAX_FRONTMATTER_VALUE_CHARS) {
          return false;
        }
      }
    }
  }
  return true;
}
