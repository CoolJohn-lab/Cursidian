#!/usr/bin/env node
/**
 * Bump the package semver and promote CHANGELOG.md [Unreleased] to a dated section.
 *
 * Agent usage: when the user says "bump the version number", run:
 *   npm run bump
 *   npm run bump -- minor
 *   npm run bump -- major
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEVELS = new Set(['patch', 'minor', 'major']);

export function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    level: 'patch',
    dryRun: false,
    noChangelog: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--no-changelog') {
      opts.noChangelog = true;
      continue;
    }
    if (LEVELS.has(arg)) {
      opts.level = arg;
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}\n` +
        `  npm run bump -- [patch|minor|major] [--dry-run] [--no-changelog]\n` +
        `  npm run bump -- --help`,
    );
  }

  return opts;
}

export function bumpSemver(version, level) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Invalid semver in package.json: ${version}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (level === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === 'minor') {
    minor += 1;
    patch = 0;
  } else if (level === 'patch') {
    patch += 1;
  } else {
    throw new Error(`Invalid bump level: ${level}`);
  }

  return `${major}.${minor}.${patch}`;
}

export function todayISO(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Promote ## [Unreleased] contents under ## [version] - date, and insert a fresh Unreleased.
 */
export function promoteChangelog(changelog, version, date = todayISO()) {
  const heading = '## [Unreleased]';
  const idx = changelog.indexOf(heading);
  if (idx === -1) {
    throw new Error('CHANGELOG.md is missing an "## [Unreleased]" heading');
  }

  const afterHeading = idx + heading.length;
  const rest = changelog.slice(afterHeading);
  const nextHeading = rest.search(/\n## \[/);
  const unreleasedBody = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const remainder = nextHeading === -1 ? '' : rest.slice(nextHeading);

  const prefix = changelog.slice(0, idx);
  const released = `## [${version}] - ${date}`;
  const body = unreleasedBody.replace(/^\r?\n/, '');

  return `${prefix}${heading}\n\n${released}\n${body.startsWith('\n') ? '' : '\n'}${body}${remainder}`;
}

export function updatePackageLock(lockText, version) {
  const lock = JSON.parse(lockText);
  lock.version = version;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = version;
  }
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function printHelp() {
  console.log(`Bump cursidian semver (package.json + package-lock.json) and CHANGELOG.md.

Usage:
  npm run bump
  npm run bump -- [patch|minor|major] [--dry-run] [--no-changelog]

Options:
  patch|minor|major   Semver level (default: patch)
  --dry-run           Print the plan without writing files
  --no-changelog      Skip CHANGELOG.md promotion
  -h, --help          Show this help

Examples:
  npm run bump
  npm run bump -- patch
  npm run bump -- minor
  npm run bump -- major --dry-run
  npm run bump -- patch --no-changelog

Success output:
  bumped 1.0.0 -> 1.0.1 (patch)
  files: package.json, package-lock.json, CHANGELOG.md`);
}

export function bumpVersion(rootDir, opts, { now } = {}) {
  const pkgPath = path.join(rootDir, 'package.json');
  const lockPath = path.join(rootDir, 'package-lock.json');
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const previous = pkg.version;
  const next = bumpSemver(previous, opts.level);
  const date = todayISO(now);
  const files = ['package.json', 'package-lock.json'];

  pkg.version = next;
  const nextPkg = `${JSON.stringify(pkg, null, 2)}\n`;

  const lockText = fs.readFileSync(lockPath, 'utf8');
  const nextLock = updatePackageLock(lockText, next);

  let nextChangelog;
  if (!opts.noChangelog) {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    nextChangelog = promoteChangelog(changelog, next, date);
    files.push('CHANGELOG.md');
  }

  if (!opts.dryRun) {
    fs.writeFileSync(pkgPath, nextPkg);
    fs.writeFileSync(lockPath, nextLock);
    if (nextChangelog !== undefined) {
      fs.writeFileSync(changelogPath, nextChangelog);
    }
  }

  return { previous, next, level: opts.level, date, files, dryRun: opts.dryRun };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  try {
    const result = bumpVersion(rootDir, opts);
    const prefix = result.dryRun ? 'dry-run: would bump' : 'bumped';
    console.log(`${prefix} ${result.previous} -> ${result.next} (${result.level})`);
    console.log(`files: ${result.files.join(', ')}`);
    if (!result.dryRun && !opts.noChangelog) {
      console.log(`changelog: [Unreleased] -> [${result.next}] - ${result.date}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error('  npm run bump -- [patch|minor|major] [--dry-run] [--no-changelog]');
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main();
}
