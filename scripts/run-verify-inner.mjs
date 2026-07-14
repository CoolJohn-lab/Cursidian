#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cleanNpmEnv, resolveSpawn } from './clean-npm-env.mjs';

const steps = [
  ['lint', ['npm', ['run', 'lint']]],
  ['typecheck', ['npm', ['run', 'typecheck']]],
  ['test', ['npm', ['run', 'test']]],
  ['build', ['npm', ['run', 'build']]],
  ['eval-gate', ['npm', ['run', 'eval', '--', '--gate']]],
  ['mcp-integration', ['node', ['scripts/mcp-integration-test.mjs']]],
  ['skills-check', ['node', ['scripts/check-skills.mjs']]],
  ['skills-install-dry', ['node', ['scripts/install-skills.mjs', '--dry-run']]],
  ['mcp-smoke', ['node', ['scripts/mcp-test.mjs', 'suite', 'smoke']]],
];

/**
 * Non-blocking follow-up steps keyed by the preceding blocking step's label.
 * A non-zero exit here logs a warning but never fails verify.
 */
const nonBlockingSteps = {
  test: ['eval-report', ['npm', ['run', 'eval', '--', '--report-only']]],
};

for (const [label, [command, args]] of steps) {
  console.error(`\n> verify:${label}`);
  const spawn = resolveSpawn(command, args);
  const result = spawnSync(spawn.command, spawn.args, {
    stdio: 'inherit',
    env: cleanNpmEnv(),
    shell: spawn.shell,
  });

  if (result.error) {
    console.error(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const followUp = nonBlockingSteps[label];
  if (followUp) {
    const [followLabel, [followCommand, followArgs]] = followUp;
    console.error(`\n> verify:${followLabel} (non-blocking)`);
    const followSpawn = resolveSpawn(followCommand, followArgs);
    const followResult = spawnSync(followSpawn.command, followSpawn.args, {
      stdio: 'inherit',
      env: cleanNpmEnv(),
      shell: followSpawn.shell,
    });
    if (followResult.status !== 0) {
      console.error(`[WARN] verify:${followLabel} failed (non-blocking).`);
    }
  }
}
