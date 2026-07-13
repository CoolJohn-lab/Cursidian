import { type Config } from '../config.js';
import { listOperationHistory } from '../lib/operation-journal.js';
import { ok, mapToolError } from '../types/index.js';

export function operationHistoryHandler(config: Config) {
  return async ({ limit }: { limit?: number }) => {
    try {
      const operations = await listOperationHistory(config.vaultPath, limit ?? 50);
      return ok(
        {
          operations: operations.map((operation) => ({
            operationId: operation.operationId,
            tool: operation.tool,
            action: operation.action,
            timestamp: operation.timestamp,
            undoAvailable: operation.undoAvailable,
            paths: operation.entries.map((entry) => entry.path),
          })),
          count: operations.length,
        },
        { action: 'history', changed: false },
      );
    } catch (e) {
      return mapToolError(e, {
        tool: 'vault',
        action: 'history',
        arguments: { action: 'history', limit },
      });
    }
  };
}
