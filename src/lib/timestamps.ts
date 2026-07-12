/**
 * Returns the current time as an ISO-8601 string.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Sets created and updated timestamps when absent from frontmatter.
 */
export function withCreateTimestamps(
  fm: Record<string, unknown>,
  now = nowIso(),
): Record<string, unknown> {
  const result = { ...fm };
  if (result.created === undefined || result.created === null || result.created === '') {
    result.created = now;
  }
  if (result.updated === undefined || result.updated === null || result.updated === '') {
    result.updated = now;
  }
  return result;
}

/**
 * Bumps the updated timestamp on frontmatter.
 */
export function withUpdatedTimestamp(
  fm: Record<string, unknown>,
  now = nowIso(),
): Record<string, unknown> {
  return { ...fm, updated: now };
}

/**
 * Bumps updated unless the caller explicitly provided updated in this write operation.
 */
export function withUpdatedTimestampUnlessProvided(
  fm: Record<string, unknown>,
  callerData: Record<string, unknown> | undefined,
  now = nowIso(),
): Record<string, unknown> {
  if (callerData !== undefined && 'updated' in callerData) {
    return fm;
  }
  return withUpdatedTimestamp(fm, now);
}
