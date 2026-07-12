import { type Config } from '../config.js';
import { getVaultIndex } from '../lib/vault-index.js';
import { countTags } from '../lib/tags.js';
import { ok, mapToolError } from '../types/index.js';

export function listTagsHandler(config: Config) {
  return async () => {
    try {
      const index = await getVaultIndex(config.vaultPath);
      const { totalTags, tags } = countTags(index);
      return ok({ totalTags, tags });
    } catch (e) {
      return mapToolError(e);
    }
  };
}
