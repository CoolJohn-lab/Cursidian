import { describe, it, expect } from 'vitest';
import {
  bumpSemver,
  parseArgs,
  promoteChangelog,
  todayISO,
  updatePackageLock,
} from '../../scripts/bump-version.mjs';

describe('parseArgs', () => {
  it('defaults to patch', () => {
    expect(parseArgs(['node', 'bump'])).toEqual({
      level: 'patch',
      dryRun: false,
      noChangelog: false,
      help: false,
    });
  });

  it('accepts level and flags', () => {
    expect(parseArgs(['node', 'bump', 'minor', '--dry-run', '--no-changelog'])).toEqual({
      level: 'minor',
      dryRun: true,
      noChangelog: true,
      help: false,
    });
  });

  it('rejects unknown args with an example invocation', () => {
    expect(() => parseArgs(['node', 'bump', '--tag'])).toThrow(/npm run bump/);
  });
});

describe('bumpSemver', () => {
  it('bumps patch, minor, and major', () => {
    expect(bumpSemver('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0');
  });

  it('rejects invalid versions', () => {
    expect(() => bumpSemver('v1.0.0', 'patch')).toThrow(/Invalid semver/);
  });
});

describe('promoteChangelog', () => {
  it('moves Unreleased under a dated version and keeps a fresh Unreleased', () => {
    const input = `# Changelog

## [Unreleased]

### Added

- new thing

## [1.0.0] - 2026-01-01

### Added

- first release
`;

    const out = promoteChangelog(input, '1.0.1', '2026-07-12');
    expect(out).toContain('## [Unreleased]\n\n## [1.0.1] - 2026-07-12\n');
    expect(out).toContain('### Added\n\n- new thing\n');
    expect(out).toContain('## [1.0.0] - 2026-01-01');
    expect(out.indexOf('## [Unreleased]')).toBeLessThan(out.indexOf('## [1.0.1]'));
  });

  it('requires an Unreleased heading', () => {
    expect(() => promoteChangelog('# Changelog\n', '1.0.1')).toThrow(/Unreleased/);
  });
});

describe('updatePackageLock', () => {
  it('updates root and packages[""] versions', () => {
    const lock = {
      name: 'cursidian',
      version: '1.0.0',
      packages: {
        '': { name: 'cursidian', version: '1.0.0' },
      },
    };
    const next = JSON.parse(updatePackageLock(JSON.stringify(lock), '1.0.1'));
    expect(next.version).toBe('1.0.1');
    expect(next.packages[''].version).toBe('1.0.1');
  });
});

describe('todayISO', () => {
  it('formats UTC YYYY-MM-DD', () => {
    expect(todayISO(new Date('2026-07-12T15:30:00Z'))).toBe('2026-07-12');
  });
});
