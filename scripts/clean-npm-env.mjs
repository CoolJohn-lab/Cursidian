#!/usr/bin/env node
/**
 * Runs a command with npm env vars migrated to npm 11.2+ conventions.
 *
 * Cursor's agent sandbox injects deprecated `npm_config_devdir` for node-gyp cache
 * isolation. npm 11.2+ warns on unknown config keys. The supported replacement is
 * `npm_package_config_node_gyp_devdir` (see node-gyp#3196 and npm/cli#8153).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx']);

export function resolveExecutable(command, platform = process.platform) {
  if (platform === 'win32' && WINDOWS_CMD_SHIMS.has(command)) {
    return `${command}.cmd`;
  }
  return command;
}

function quoteWindowsArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function resolveSpawn(command, args = [], platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: [command, ...args].map(quoteWindowsArg).join(' '),
      args: [],
      shell: true,
    };
  }

  return {
    command: resolveExecutable(command, platform),
    args,
    shell: false,
  };
}

/**
 * Migrates deprecated npm_config_devdir to npm_package_config_node_gyp_devdir and
 * removes keys that trigger npm 11.2+ unknown-config warnings.
 */
export function cleanNpmEnv(env = process.env) {
  const cleaned = { ...env };

  const legacyDevdir = cleaned.npm_config_devdir ?? cleaned.NPM_CONFIG_DEVDIR;
  if (legacyDevdir && !cleaned.npm_package_config_node_gyp_devdir) {
    cleaned.npm_package_config_node_gyp_devdir = legacyDevdir;
  }

  delete cleaned.npm_config_devdir;
  delete cleaned.NPM_CONFIG_DEVDIR;

  const pathKey = Object.keys(cleaned).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const localBin = path.resolve('node_modules', '.bin');
  const currentPath = cleaned[pathKey];
  if (typeof currentPath === 'string' && !currentPath.split(path.delimiter).includes(localBin)) {
    cleaned[pathKey] = `${localBin}${path.delimiter}${currentPath}`;
  }

  return cleaned;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: node scripts/clean-npm-env.mjs <command> [args...]');
    console.error('Example: node scripts/clean-npm-env.mjs npm test');
    process.exit(1);
  }

  const [command, ...args] = argv;
  const spawn = resolveSpawn(command, args);
  const result = spawnSync(spawn.command, spawn.args, {
    stdio: 'inherit',
    env: cleanNpmEnv(),
    shell: spawn.shell,
  });

  if (result.error) {
    console.error(result.error.message);
  }

  process.exit(result.status ?? 1);
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFile === invokedFile) {
  main();
}
