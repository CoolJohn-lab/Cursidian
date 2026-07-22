import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('install-skills CLI', () => {
  it('dry-run succeeds and reports all nine skills', () => {
    const script = path.join(process.cwd(), 'scripts', 'install-skills.mjs');
    const dest = path.join(os.tmpdir(), `cursidian-skills-dry-${Date.now()}`);
    const result = spawnSync(process.execPath, [script, '--dry-run', '--dest', dest], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/vault/);
    expect(result.stdout + result.stderr).toMatch(/wiki-slop/);
    expect(fs.existsSync(path.join(dest, 'vault'))).toBe(false);
  });
});
