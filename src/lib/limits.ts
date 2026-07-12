/** Maximum note body or tool content string (bytes, UTF-8). */
export const MAX_CONTENT_BYTES = 10_485_760;

/** Maximum search query length (characters). */
export const MAX_QUERY_LENGTH = 2_000;

/** Maximum log line / hot activity length (characters). */
export const MAX_LOG_LINE_LENGTH = 8_000;

/** Maximum frontmatter keys in one request. */
export const MAX_FRONTMATTER_KEYS = 128;

/** Maximum list/search results per page. */
export const MAX_LIST_LIMIT = 500;

/** Default list page size. */
export const DEFAULT_LIST_LIMIT = 200;

/** Maximum recent notes (schema and runtime aligned). */
export const MAX_RECENT_LIMIT = 100;

/** Vocabulary size above which typo correction is skipped. */
export const MAX_TYPO_VOCAB_SIZE = 5_000;

/** Maximum YAML frontmatter block size (bytes). */
export const MAX_FRONTMATTER_BYTES = 65_536;

/** Default backup retention: keep at most this many backup sessions. */
export const DEFAULT_BACKUP_RETENTION = 50;
