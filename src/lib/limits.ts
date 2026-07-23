/** Maximum note body or tool content string (bytes, UTF-8). */
export const MAX_CONTENT_BYTES = 10_485_760;

/** Maximum search query length (characters). */
export const MAX_QUERY_LENGTH = 2_000;

/** Maximum frontmatter keys in one request. */
export const MAX_FRONTMATTER_KEYS = 128;

/** Maximum list/search results per page. */
export const MAX_LIST_LIMIT = 500;

/** Default list page size. */
export const DEFAULT_LIST_LIMIT = 200;

/** Maximum recent notes (schema and runtime aligned). */
export const MAX_RECENT_LIMIT = 100;

/** Default graph backlink page size. */
export const DEFAULT_GRAPH_BACKLINK_LIMIT = 50;

/** Maximum graph backlink page size. */
export const MAX_GRAPH_BACKLINK_LIMIT = 200;

/** Vocabulary size above which typo correction is skipped. */
export const MAX_TYPO_VOCAB_SIZE = 5_000;

/** Typo-correct only the first N query tokens. */
export const MAX_CORRECTION_TOKENS = 24;

/** Never build an edit-distance matrix wider/taller than this. */
export const MAX_TOKEN_LEN = 64;

/** Maximum YAML frontmatter block size (bytes). */
export const MAX_FRONTMATTER_BYTES = 65_536;

/** Maximum input size for shared parsers (wikilinks, tags, manifest, vocabulary). */
export const MAX_PARSE_INPUT_BYTES = 5 * 1024 * 1024;

/** Cap on regex exec() iterations in shared parsers. */
export const MAX_MATCH_ITERATIONS = 50_000;

/** Default backup retention: keep at most this many backup sessions. */
export const DEFAULT_BACKUP_RETENTION = 50;

/** Throws when content exceeds the shared parse-size budget. */
export function assertParseableSize(content: string, what: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_PARSE_INPUT_BYTES) {
    throw new Error(`${what} exceeds ${MAX_PARSE_INPUT_BYTES} bytes; refusing to parse.`);
  }
}
