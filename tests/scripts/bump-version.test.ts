import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bumpSemver,
  parseArgs,
  promoteChangelog,
  extractUnreleasedBody,
  isChangelogBodyEmpty,
  findEmptyReleasedSections,
  bumpVersion,
  todayISO,
  updatePackageLock,
} from '../../scripts/bump-version.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

describe('parseArgs', () => {
  it('defaults to patch', () => {
    expect(parseArgs(['node', 'bump'])).toEqual({
      level: 'patch',
      dryRun: false,
      noChangelog: false,
      allowEmptyChangelog: false,
      help: false,
    });
  });

  it('accepts level and flags', () => {
    expect(
      parseArgs([
        'node',
        'bump',
        'minor',
        '--dry-run',
        '--no-changelog',
        '--allow-empty-changelog',
      ]),
    ).toEqual({
      level: 'minor',
      dryRun: true,
      noChangelog: true,
      allowEmptyChangelog: true,
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

describe('extractUnreleasedBody', () => {
  it('returns text between Unreleased and the next version heading', () => {
    const input = `# Changelog

## [Unreleased]

### Added

- new thing

## [1.0.0] - 2026-01-01
`;
    expect(extractUnreleasedBody(input).trim()).toBe('### Added\n\n- new thing');
  });

  it('requires an Unreleased heading', () => {
    expect(() => extractUnreleasedBody('# Changelog\n')).toThrow(/Unreleased/);
  });
});

describe('isChangelogBodyEmpty', () => {
  it('treats whitespace-only as empty', () => {
    expect(isChangelogBodyEmpty('\n\n  \n')).toBe(true);
  });

  it('treats headings-only as empty', () => {
    expect(isChangelogBodyEmpty('\n### Added\n\n### Changed\n')).toBe(true);
  });

  it('treats bullet lists as non-empty', () => {
    expect(isChangelogBodyEmpty('\n### Added\n\n- item\n')).toBe(false);
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

describe('bumpVersion changelog guard', () => {
  it('rejects bump when Unreleased is empty', () => {
    const emptyUnreleased = `# Changelog

## [Unreleased]

## [1.0.0] - 2026-01-01

### Added

- first
`;
    expect(isChangelogBodyEmpty(extractUnreleasedBody(emptyUnreleased))).toBe(true);

    const tmpDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-bump-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        `${JSON.stringify({ name: 'cursidian', version: '1.0.0' }, null, 2)}\n`,
      );
      fs.writeFileSync(
        path.join(tmpDir, 'package-lock.json'),
        `${JSON.stringify({ name: 'cursidian', version: '1.0.0', packages: { '': { version: '1.0.0' } } }, null, 2)}\n`,
      );
      fs.writeFileSync(path.join(tmpDir, 'CHANGELOG.md'), emptyUnreleased);

      expect(() =>
        bumpVersion(tmpDir, {
          level: 'patch',
          dryRun: true,
          noChangelog: false,
          allowEmptyChangelog: false,
        }),
      ).toThrow(/Add notes under \[Unreleased\]/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const repoChangelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
    if (isChangelogBodyEmpty(extractUnreleasedBody(repoChangelog))) {
      expect(() =>
        bumpVersion(repoRoot, {
          level: 'patch',
          dryRun: true,
          noChangelog: false,
          allowEmptyChangelog: false,
        }),
      ).toThrow(/Add notes under \[Unreleased\]/);
    } else {
      expect(() =>
        bumpVersion(repoRoot, {
          level: 'patch',
          dryRun: true,
          noChangelog: false,
          allowEmptyChangelog: false,
        }),
      ).not.toThrow();
    }
  });

  it('allows empty Unreleased with --allow-empty-changelog', () => {
    const tmpDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-bump-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        `${JSON.stringify({ name: 'cursidian', version: '1.0.0' }, null, 2)}\n`,
      );
      fs.writeFileSync(
        path.join(tmpDir, 'package-lock.json'),
        `${JSON.stringify({ name: 'cursidian', version: '1.0.0', packages: { '': { version: '1.0.0' } } }, null, 2)}\n`,
      );
      fs.writeFileSync(
        path.join(tmpDir, 'CHANGELOG.md'),
        `# Changelog

## [Unreleased]

## [1.0.0] - 2026-01-01
`,
      );

      expect(() =>
        bumpVersion(tmpDir, {
          level: 'patch',
          dryRun: true,
          noChangelog: false,
          allowEmptyChangelog: false,
        }),
      ).toThrow(/Add notes under \[Unreleased\]/);

      const result = bumpVersion(tmpDir, {
        level: 'patch',
        dryRun: true,
        noChangelog: false,
        allowEmptyChangelog: true,
      });
      expect(result.next).toBe('1.0.1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('findEmptyReleasedSections', () => {
  it('returns versions with no substantive notes', () => {
    const input = `# Changelog

## [Unreleased]

### Added

- pending

## [2.0.0] - 2026-07-12


## [1.0.0] - 2026-07-12

### Added

- shipped
`;
    expect(findEmptyReleasedSections(input)).toEqual(['2.0.0']);
  });

  it('finds no empty sections in the repo CHANGELOG', () => {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    expect(findEmptyReleasedSections(changelog)).toEqual([]);
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
