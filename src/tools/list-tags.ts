import { type Config } from '../config.js';
import { getVaultIndex } from '../lib/vault-index.js';
import { countTags, uniqueIndexEntries } from '../lib/tags.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { ok, mapToolError } from '../types/index.js';

export function listTagsHandler(config: Config) {
  return async () => {
    try {
      const index = await getVaultIndex(config.vaultPath);
      const catalogIndex = new Map(
        uniqueIndexEntries(index)
          .filter((entry) => !isOperationalPath(entry.path))
          .map((entry) => [entry.path, entry]),
      );
      const { totalTags, tags } = countTags(catalogIndex);
      return ok({ totalTags, tags });
    } catch (e) {
      return mapToolError(e);
    }
  };
}
