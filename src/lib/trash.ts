/** Active trash directory name for pre-write backups. */
export const TRASH_DIR_NAME = '.cursidian-trash';

/** Legacy trash directory from pre-1.0 branding; deleted on first backup. */
export const LEGACY_TRASH_DIR_NAME = '.obsidian-mcp-trash';

/** fast-glob ignore pattern for the active trash directory. */
export const TRASH_GLOB_IGNORE = `**/${TRASH_DIR_NAME}/**`;
