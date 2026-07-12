import { type Config } from '../config.js';
import { computeVaultHealth } from '../lib/vault-health.js';
import { ok, mapToolError } from '../types/index.js';

export function vaultHealthHandler(config: Config) {
  return async ({ staleDays }: { staleDays?: number }) => {
    try {
      const report = await computeVaultHealth(config.vaultPath, staleDays ?? 90);
      return ok(report);
    } catch (e) {
      return mapToolError(e);
    }
  };
}
