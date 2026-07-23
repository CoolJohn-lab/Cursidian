import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v3';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import {
  assembleContextDetailed,
  expandContextDetailed,
  InvalidContextCursorError,
} from '../lib/context-assembler.js';
import { recordContextLogdump } from '../lib/context-logdump.js';
import { assertNotReadOnly } from '../lib/security.js';
import { logger } from '../lib/logger.js';
import { MAX_QUERY_LENGTH } from '../lib/limits.js';
import { invalidArgsError, ok, validateActionArguments, mapToolError } from '../types/index.js';
import type { ContextBundle, ContextIntent } from '../types/index.js';

const CONTEXT_INTENTS = [
  'lookup',
  'connection',
  'onboarding',
  'troubleshoot',
  'ingest-prep',
] as const;
const MAX_TOKEN_BUDGET = 50_000;
const DEFAULT_TOKEN_BUDGET = 4_000;
const FEEDBACK_RELATIVE_PATH = '.cursidian/context-feedback.jsonl';
const MAX_FEEDBACK_NOTE_LENGTH = 2_000;
const TELEMETRY_ENV_VAR = 'OBSIDIAN_CONTEXT_TELEMETRY';
const TELEMETRY_FILE_NAME = 'context-telemetry.jsonl';
const TELEMETRY_RELATIVE_PATH = `.cursidian/${TELEMETRY_FILE_NAME}`;

/** Word/char shape only - never the raw query text - so telemetry stays safe on client-adjacent vaults. */
function queryShapeOf(text: string): { length: number; wordCount: number } {
  const trimmed = text.trim();
  return {
    length: trimmed.length,
    wordCount: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
  };
}

/**
 * Opt-in, local-only observability for the context engine (OBSIDIAN_CONTEXT_TELEMETRY=true;
 * default off). Never writes to stdout - that is reserved for MCP JSON-RPC. Writes next to
 * OBSIDIAN_LOG_FILE when configured, otherwise to .cursidian/context-telemetry.jsonl in the
 * vault. Best-effort: a telemetry write failure must never fail the context call it describes.
 */
async function recordContextTelemetry(
  config: Config,
  action: string,
  bundle: ContextBundle,
  latencyMs: number,
): Promise<void> {
  if (process.env[TELEMETRY_ENV_VAR] !== 'true') {
    return;
  }
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      queryShape: queryShapeOf(bundle.query),
      intent: bundle.intent,
      tokenBudget: bundle.tokenBudget,
      tokensUsed: bundle.tokensUsed,
      itemCount: bundle.items.length,
      bundleConfidence: bundle.bundleConfidence ?? 0,
      warningCount: bundle.warnings.length,
      latencyMs,
    };
    const logFile = process.env.OBSIDIAN_LOG_FILE?.trim();
    const target = logFile
      ? path.join(path.dirname(logFile), TELEMETRY_FILE_NAME)
      : path.join(config.vaultPath, TELEMETRY_RELATIVE_PATH);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch (e) {
    logger.debug('Context telemetry write failed', {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function recordContextFeedback(
  config: Config,
  entry: {
    query: string;
    verdict: 'insufficient' | 'off_target';
    note?: string;
  },
): Promise<{ path: string; recorded: boolean }> {
  assertNotReadOnly(config.readOnly);
  const resolved = path.join(config.vaultPath, FEEDBACK_RELATIVE_PATH);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    query: entry.query,
    verdict: entry.verdict,
    note: entry.note,
  });
  await fs.appendFile(resolved, `${line}\n`, 'utf-8');
  logger.info('Context feedback recorded', { verdict: entry.verdict });
  return { path: FEEDBACK_RELATIVE_PATH, recorded: true };
}

export function registerContext(server: McpServer, config: Config): void {
  server.registerTool(
    'context',
    {
      description:
        'Assembles a token-budgeted, provenance-tagged context bundle - the CGE surface. Prefer for the first wiki retrieval in a session. action=assemble (default): query + tokenBudget (default 4000), optional intent (lookup|connection|onboarding|troubleshoot|ingest-prep, inferred from the query when omitted). action=for_task: same assembly, phrased as a task description. action=expand: continue a prior bundle via its nextCursor with a fresh tokenBudget. action=feedback: record that a bundle was insufficient or off-target for a query (local vault log only, read-only vaults reject this). Bundles are read-only and compose search/graph internally; never exceed tokenBudget; items carry kind (summary|section|body|neighbor-note), score, reasons, provenance, staleDays, and citations as [[wikilinks]]. Response includes focus (1-3 primary paths) and guidance.nextStep (sufficient|expand|refine_query) for session-first agents.',
      inputSchema: {
        action: z
          .enum(['assemble', 'for_task', 'expand', 'feedback'])
          .optional()
          .default('assemble')
          .describe('Selects assemble, for_task, expand, or feedback; defaults to assemble'),
        query: z.string().min(1).max(MAX_QUERY_LENGTH).optional().describe('Used by assemble only'),
        task: z.string().min(1).max(MAX_QUERY_LENGTH).optional().describe('Used by for_task only'),
        intent: z
          .enum(CONTEXT_INTENTS)
          .optional()
          .describe('Used by assemble and for_task; inferred from the query/task when omitted'),
        tokenBudget: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOKEN_BUDGET)
          .optional()
          .describe('Used by assemble, for_task, and expand; defaults to 4000'),
        cursor: z.string().optional().describe('Used by expand only - a prior bundle nextCursor'),
        feedbackQuery: z
          .string()
          .min(1)
          .max(MAX_QUERY_LENGTH)
          .optional()
          .describe('Used by feedback only'),
        feedbackVerdict: z
          .enum(['insufficient', 'off_target'])
          .optional()
          .describe('Used by feedback only'),
        feedbackNote: z
          .string()
          .max(MAX_FEEDBACK_NOTE_LENGTH)
          .optional()
          .describe('Used by feedback only'),
      },
    },
    async (args) => {
      const action = args.action ?? 'assemble';
      const specs: Record<string, { allowed: string[]; required?: string[] }> = {
        assemble: { allowed: ['query', 'intent', 'tokenBudget'], required: ['query'] },
        for_task: { allowed: ['task', 'intent', 'tokenBudget'], required: ['task'] },
        expand: { allowed: ['cursor', 'tokenBudget'], required: ['cursor'] },
        feedback: {
          allowed: ['feedbackQuery', 'feedbackVerdict', 'feedbackNote'],
          required: ['feedbackQuery', 'feedbackVerdict'],
        },
      };
      const spec = specs[action];
      const validation = validateActionArguments({
        tool: 'context',
        action,
        args: { ...args, action },
        allowed: spec.allowed,
        required: spec.required,
      });
      if (validation) {
        return validation;
      }

      const {
        query,
        task,
        intent,
        tokenBudget,
        cursor,
        feedbackQuery,
        feedbackVerdict,
        feedbackNote,
      } = args;
      const effectiveTokenBudget = tokenBudget ?? DEFAULT_TOKEN_BUDGET;
      const logInput = (): Record<string, unknown> => ({
        action,
        ...(query !== undefined ? { query } : {}),
        ...(task !== undefined ? { task } : {}),
        ...(intent !== undefined ? { intent } : {}),
        ...(tokenBudget !== undefined ? { tokenBudget } : { tokenBudget: effectiveTokenBudget }),
        ...(cursor !== undefined ? { cursor } : {}),
        ...(feedbackQuery !== undefined ? { feedbackQuery } : {}),
        ...(feedbackVerdict !== undefined ? { feedbackVerdict } : {}),
        ...(feedbackNote !== undefined ? { feedbackNote } : {}),
      });

      try {
        switch (action) {
          case 'assemble': {
            const startedAt = Date.now();
            const { bundle, diagnostics } = await assembleContextDetailed(config, {
              query: query as string,
              intent: intent as ContextIntent | undefined,
              tokenBudget: effectiveTokenBudget,
            });
            const latencyMs = Date.now() - startedAt;
            await recordContextTelemetry(config, action, bundle, latencyMs);
            await recordContextLogdump({
              latencyMs,
              status: 'success',
              input: logInput(),
              output: bundle,
              ranking: diagnostics,
            });
            return ok(bundle, {
              action,
              changed: false,
              paths: bundle.coverage.includedPaths,
              warnings: bundle.warnings,
            });
          }
          case 'for_task': {
            const startedAt = Date.now();
            const { bundle, diagnostics } = await assembleContextDetailed(config, {
              query: task as string,
              intent: intent as ContextIntent | undefined,
              tokenBudget: effectiveTokenBudget,
            });
            const latencyMs = Date.now() - startedAt;
            await recordContextTelemetry(config, action, bundle, latencyMs);
            await recordContextLogdump({
              latencyMs,
              status: 'success',
              input: logInput(),
              output: bundle,
              ranking: diagnostics,
            });
            return ok(bundle, {
              action,
              changed: false,
              paths: bundle.coverage.includedPaths,
              warnings: bundle.warnings,
            });
          }
          case 'expand': {
            const startedAt = Date.now();
            try {
              const { bundle, diagnostics } = await expandContextDetailed(
                config,
                cursor as string,
                effectiveTokenBudget,
              );
              const latencyMs = Date.now() - startedAt;
              await recordContextTelemetry(config, action, bundle, latencyMs);
              await recordContextLogdump({
                latencyMs,
                status: 'success',
                input: logInput(),
                output: bundle,
                ranking: diagnostics,
              });
              return ok(bundle, {
                action,
                changed: false,
                paths: bundle.coverage.includedPaths,
                warnings: bundle.warnings,
              });
            } catch (e) {
              if (e instanceof InvalidContextCursorError) {
                const errResult = invalidArgsError({
                  tool: 'context',
                  action,
                  message: e.message,
                  required: ['cursor'],
                  missing: [],
                  rejected: ['cursor'],
                  arguments: { action: 'assemble', query: '<query>' },
                });
                await recordContextLogdump({
                  latencyMs: Date.now() - startedAt,
                  status: 'error',
                  input: logInput(),
                  output: JSON.parse(errResult.content[0]?.text ?? '{}') as unknown,
                });
                return errResult;
              }
              throw e;
            }
          }
          case 'feedback': {
            const startedAt = Date.now();
            const result = await recordContextFeedback(config, {
              query: feedbackQuery as string,
              verdict: feedbackVerdict as 'insufficient' | 'off_target',
              note: feedbackNote,
            });
            await recordContextLogdump({
              latencyMs: Date.now() - startedAt,
              status: 'success',
              input: logInput(),
              output: result,
            });
            return ok(result, { action, changed: true, paths: [result.path] });
          }
          default:
            return invalidArgsError({
              tool: 'context',
              action: action as string,
              message: `Unknown action: ${action as string}`,
              rejected: ['action'],
              arguments: { action: 'assemble', query: '<query>' },
            });
        }
      } catch (e) {
        const errResult = mapToolError(e, {
          tool: 'context',
          action,
          arguments: { action, query, task, cursor },
        });
        await recordContextLogdump({
          latencyMs: 0,
          status: 'error',
          input: logInput(),
          output: JSON.parse(errResult.content[0]?.text ?? '{}') as unknown,
        });
        return errResult;
      }
    },
  );
}
