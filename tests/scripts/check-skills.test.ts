import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('skills:check', () => {
  it('passes static contract checks over skills/wiki', () => {
    const script = path.join(process.cwd(), 'scripts', 'check-skills.mjs');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/skills:check - clean/);
  });
});
