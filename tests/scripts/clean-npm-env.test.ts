import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { cleanNpmEnv, resolveExecutable, resolveSpawn } from '../../scripts/clean-npm-env.mjs';

describe('cleanNpmEnv', () => {
  it('migrates npm_config_devdir to npm_package_config_node_gyp_devdir', () => {
    const result = cleanNpmEnv({
      npm_config_devdir: '/tmp/node-gyp-cache',
      OTHER: 'keep',
    });

    expect(result.npm_package_config_node_gyp_devdir).toBe('/tmp/node-gyp-cache');
    expect(result.npm_config_devdir).toBeUndefined();
    expect(result.NPM_CONFIG_DEVDIR).toBeUndefined();
    expect(result.OTHER).toBe('keep');
  });

  it('does not overwrite an existing npm_package_config_node_gyp_devdir', () => {
    const result = cleanNpmEnv({
      npm_config_devdir: '/legacy',
      npm_package_config_node_gyp_devdir: '/preferred',
    });

    expect(result.npm_package_config_node_gyp_devdir).toBe('/preferred');
    expect(result.npm_config_devdir).toBeUndefined();
  });

  it('removes all devdir env vars before spawning npm 12 child processes', () => {
    const result = cleanNpmEnv({
      npm_config_devdir: '/lowercase',
      NPM_CONFIG_DEVDIR: '/uppercase',
    });

    expect(result.npm_package_config_node_gyp_devdir).toBe('/lowercase');
    expect(result.npm_config_devdir).toBeUndefined();
    expect(result.NPM_CONFIG_DEVDIR).toBeUndefined();
    expect(Object.keys(result).some((key) => key.toLowerCase() === 'npm_config_devdir')).toBe(false);
  });

  it('resolves npm shims on Windows without requiring shell command parsing', () => {
    expect(resolveExecutable('npm', 'win32')).toBe('npm.cmd');
    expect(resolveExecutable('npx', 'win32')).toBe('npx.cmd');
    expect(resolveExecutable('node', 'win32')).toBe('node');
    expect(resolveExecutable('npm', 'linux')).toBe('npm');
  });

  it('builds a Windows shell command without passing a separate args array', () => {
    expect(resolveSpawn('npm', ['run', 'verify:inner'], 'win32')).toEqual({
      command: 'npm run verify:inner',
      args: [],
      shell: true,
    });
  });

  it('prepends local node_modules binaries for direct tool invocations', () => {
    const result = cleanNpmEnv({ PATH: 'C:\\Windows\\System32' });
    const localBin = path.resolve('node_modules', '.bin');

    expect(result.PATH?.split(path.delimiter)[0]).toBe(localBin);
  });
});
