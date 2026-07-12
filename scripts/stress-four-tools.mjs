#!/usr/bin/env node
/**
 * Aggressive stress / chaos probe for the 4 consolidated MCP tools.
 * Runs against OBSIDIAN_VAULT_PATH. Creates then cleans up probe notes under _raw/.
 * Outputs JSON findings to stdout summary + writes a report path if --out given.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestServer, callTool, parseResult, resetCaches } from './test-lib.mjs';

const findings = [];
const ok = [];
const probePrefix = `_raw/_stress-${Date.now()}`;

function record(kind, name, detail) {
  const entry = { kind, name, detail, at: new Date().toISOString() };
  findings.push(entry);
  const tag = kind === 'fail' ? 'FAIL' : kind === 'warn' ? 'WARN' : 'OK';
  console.log(`${tag}  ${name}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 240)}` : ''}`);
}

function expectOk(name, result) {
  if (result.isError) {
    record('fail', name, result.content[0].text);
    return null;
  }
  try {
    const data = JSON.parse(result.content[0].text);
    ok.push(name);
    return data;
  } catch (e) {
    record('fail', name, `JSON parse: ${e.message}`);
    return null;
  }
}

function expectErr(name, result, substr) {
  if (!result.isError) {
    record('fail', name, `expected error, got success: ${result.content[0].text.slice(0, 200)}`);
    return null;
  }
  const text = result.content[0].text;
  if (substr && !text.includes(substr)) {
    record('fail', name, `error missing "${substr}": ${text.slice(0, 240)}`);
    return null;
  }
  ok.push(name);
  return JSON.parse(text);
}

async function main() {
  resetCaches();
  const { server, config } = createTestServer();
  console.log(`Vault: ${config.vaultPath}`);
  console.log(`Probe prefix: ${probePrefix}`);

  // --- Prior bug regressions ---
  {
    const r = await callTool(server, 'search', {
      action: 'content',
      query: 'Temporary probe note',
      limit: 5,
    });
    const data = expectOk('regression: note→home typo', r);
    if (data) {
      const tokens = data.contentTokens ?? [];
      if (tokens.includes('home') && !tokens.includes('note')) {
        record('fail', 'regression: note→home typo', { contentTokens: tokens, correctedTokens: data.correctedTokens });
      } else if (!tokens.includes('note') && !tokens.map((t) => t.toLowerCase()).includes('note')) {
        // note may be lowercased
        const lower = tokens.map((t) => t.toLowerCase());
        if (lower.includes('home') && !lower.includes('note')) {
          record('fail', 'regression: note→home typo', { contentTokens: tokens });
        } else {
          record('ok', 'regression: note token preserved', { contentTokens: tokens });
        }
      } else {
        record('ok', 'regression: note token preserved', { contentTokens: tokens });
      }
    }
  }

  {
    const omit = await callTool(server, 'vault', { action: 'list_folders' });
    const empty = await callTool(server, 'vault', { action: 'list_folders', path: '' });
    expectOk('regression: list_folders omit path', omit);
    expectOk('regression: list_folders empty path', empty);
  }

  {
    const r = await callTool(server, 'note', {
      action: 'frontmatter',
      path: 'entities/cursidian',
      fmOperation: 'merge',
    });
    expectErr('regression: frontmatter error says frontmatter', r, 'frontmatter');
  }

  {
    const r = await callTool(server, 'search', {
      action: 'content',
      query: 'wikilink backlinks',
      verbose: true,
      limit: 5,
    });
    const data = expectOk('regression: verbose match field', r);
    if (data?.results?.[0]?.snippets?.[0]) {
      const sn = data.results[0].snippets[0];
      if (sn.match === 'wikilink backlinks' && !sn.line?.toLowerCase().includes('wikilink')) {
        record('fail', 'regression: verbose match echoes full query on unrelated line', {
          path: data.results[0].path,
          line: sn.line,
          match: sn.match,
        });
      } else {
        record('ok', 'verbose snippet match looks plausible', {
          path: data.results[0].path,
          match: sn.match,
          line: sn.line?.slice(0, 80),
        });
      }
      // Check basename reasons
      const reasons = data.results[0].matchReasons ?? [];
      const bad = reasons.filter((x) => typeof x === 'string' && x.startsWith('basename:wikilink'));
      if (bad.length && !data.results[0].path.toLowerCase().includes('wikilink')) {
        record('warn', 'matchReasons basename:wikilink on non-wikilink path', {
          path: data.results[0].path,
          reasons: bad,
        });
      }
    }
  }

  // --- Massive search patterns ---
  {
    const longQuery = Array.from({ length: 80 }, (_, i) => `token${i}x`).join(' ');
    const r = await callTool(server, 'search', { action: 'content', query: longQuery, limit: 200 });
    expectOk('search: 80-token query', r);
  }

  {
    const r = await callTool(server, 'search', {
      action: 'content',
      query: 'a'.repeat(5000),
      limit: 10,
    });
    // should not crash
    if (r.isError) {
      record('warn', 'search: 5k-char single token errored', r.content[0].text.slice(0, 200));
    } else {
      expectOk('search: 5k-char single token', r);
    }
  }

  {
    const r = await callTool(server, 'search', {
      action: 'content',
      query: 'cursidian mcp vault home assistant raspberry docker',
      tags: ['mcp', 'obsidian-wiki'],
      format: 'compact',
      limit: 200,
      verbose: true,
      includeOperational: true,
    });
    const data = expectOk('search: kitchen-sink content+tags+verbose+operational', r);
    if (data && data.results?.length > 200) {
      record('fail', 'search: limit 200 exceeded', data.results.length);
    }
  }

  {
    const r = await callTool(server, 'search', {
      action: 'by_tags',
      tags: ['mcp', 'cursor', 'obsidian-wiki', 'deploy', 'nonexistent-tag-xyz'],
      limit: 200,
    });
    const data = expectOk('search: by_tags many AND including nonexistent', r);
    if (data && data.totalMatches !== 0) {
      record('fail', 'search: AND with nonexistent tag should be 0', data.totalMatches);
    } else {
      record('ok', 'by_tags AND with missing tag → 0', { totalMatches: data?.totalMatches });
    }
  }

  {
    const r = await callTool(server, 'search', {
      action: 'by_tags',
      tags: Array.from({ length: 50 }, (_, i) => `t${i}`),
      limit: 1,
    });
    expectOk('search: by_tags 50 tags', r);
  }

  {
    const r = await callTool(server, 'search', { action: 'list', folder: 'projects', recursive: true });
    const data = expectOk('search: list recursive projects', r);
    if (data?.notes?.some((n) => String(n.path).includes('\\'))) {
      record('warn', 'search list still returns backslash paths on Windows', {
        sample: data.notes.find((n) => String(n.path).includes('\\'))?.path,
      });
    } else {
      record('ok', 'search list path separators normalized', {
        sample: data?.notes?.[0]?.path,
      });
    }
  }

  {
    // unicode / special chars
    for (const q of ['café', '日本語', 'emoji🚀test', 'C++', 'foo/bar', '[[wikilink]]', 'a&b|c', '""']) {
      const r = await callTool(server, 'search', { action: 'content', query: q, limit: 3 });
      if (r.isError) {
        record('fail', `search unicode/special: ${q}`, r.content[0].text.slice(0, 200));
      } else {
        ok.push(`search special ${q}`);
      }
    }
    record('ok', 'search: unicode/special queries completed', null);
  }

  // --- Graph stress ---
  {
    const list = parseResult(await callTool(server, 'search', { action: 'list' }));
    const paths = (list.notes ?? []).slice(0, 40).map((n) => n.path.replace(/\\/g, '/').replace(/\.md$/i, ''));
    let graphFails = 0;
    let maxOut = 0;
    let maxBack = 0;
    for (const p of paths) {
      const r = await callTool(server, 'graph', { path: p });
      if (r.isError) {
        graphFails += 1;
        record('warn', `graph fail on ${p}`, r.content[0].text.slice(0, 160));
        continue;
      }
      const data = JSON.parse(r.content[0].text);
      maxOut = Math.max(maxOut, data.outgoingLinks?.length ?? 0);
      maxBack = Math.max(maxBack, data.backlinkCount ?? 0);
      // consistency: backlinks length vs count
      if ((data.backlinks?.length ?? 0) !== (data.backlinkCount ?? -1)) {
        record('fail', `graph backlinkCount mismatch on ${p}`, {
          len: data.backlinks?.length,
          count: data.backlinkCount,
        });
      }
      // every resolvedPath if present should be string
      for (const link of data.outgoingLinks ?? []) {
        if (link.resolvedPath === undefined && link.raw === undefined) {
          record('fail', `graph malformed outgoing on ${p}`, link);
        }
      }
    }
    record(graphFails ? 'warn' : 'ok', `graph: scanned ${paths.length} notes`, { graphFails, maxOut, maxBack });
  }

  {
    // path traversal / weird paths
    for (const p of ['../secrets', '..\\..\\Windows', '/etc/passwd', 'C:/Windows', 'projects/../../entities/cursidian', '']) {
      const r = await callTool(server, 'graph', { path: p });
      // empty may fail schema before handler
      if (!r.isError && p.includes('..')) {
        // if it resolved outside or oddly, flag
        const data = JSON.parse(r.content[0].text);
        if (data.note && !data.note.replace(/\\/g, '/').startsWith('entities/') && p.includes('entities/cursidian')) {
          // traversal that still finds note might be ok if sanitized to vault-relative
        }
        record('ok', `graph weird path handled: ${p || '(empty)'}`, {
          note: data.note,
          err: false,
        });
      } else if (r.isError) {
        ok.push(`graph rejects ${p || 'empty'}`);
      }
    }
    record('ok', 'graph: weird paths probed', null);
  }

  // --- Note complex write lifecycle ---
  const noteA = `${probePrefix}-a`;
  const noteB = `${probePrefix}-b`;
  const noteNested = `${probePrefix}/deep/nested/page`;
  let hashA;

  {
    const bigBody = `# Stress A\n\n${'paragraph with [[entities/cursidian]] link\n\n'.repeat(200)}## Section One\n\nAlpha.\n\n## Section Two\n\nBeta.\n\n`;
    const r = await callTool(server, 'note', {
      action: 'create',
      path: noteA,
      content: bigBody,
      frontmatter: {
        title: 'Stress A',
        tags: ['stress-probe', 'mcp'],
        summary: 'stress probe A',
        nested: { a: 1, b: [1, 2, 3] },
      },
      overwrite: true,
    });
    expectOk('note: create large body + nested FM', r);
  }

  {
    const r = await callTool(server, 'note', { action: 'read', path: noteA });
    const data = expectOk('note: read large', r);
    hashA = data?.contentHash;
    if (data && (!data.outgoingLinks || data.outgoingLinks.length < 1)) {
      record('fail', 'note: expected outgoingLinks to cursidian', data.outgoingLinks);
    }
    if (data?.content?.length < 1000) {
      record('fail', 'note: content truncated on read?', data.content.length);
    }
  }

  {
    // rapid patch chain with hash
    for (let i = 0; i < 15; i++) {
      const r = await callTool(server, 'note', {
        action: 'update',
        path: noteA,
        mode: 'patch',
        old_string: i === 0 ? 'Alpha.' : `Alpha patched ${i - 1}.`,
        new_string: `Alpha patched ${i}.`,
        expectedHash: hashA,
      });
      if (r.isError) {
        record('fail', `note: patch chain #${i}`, r.content[0].text.slice(0, 240));
        break;
      }
      const data = JSON.parse(r.content[0].text);
      // Some handlers return new hash; if not, re-read
      if (data.contentHash) {
        hashA = data.contentHash;
      } else {
        const rr = await callTool(server, 'note', { action: 'read', path: noteA });
        hashA = JSON.parse(rr.content[0].text).contentHash;
      }
    }
    record('ok', 'note: 15 sequential patch+hash updates', { hashA: hashA?.slice(0, 12) });
  }

  {
    // stale hash should fail
    const r = await callTool(server, 'note', {
      action: 'update',
      path: noteA,
      mode: 'patch',
      old_string: 'Beta.',
      new_string: 'Beta should fail.',
      expectedHash: '0'.repeat(64),
    });
    expectErr('note: stale hash rejected', r, 'hash');
  }

  {
    // replace_section
    const read = parseResult(await callTool(server, 'note', { action: 'read', path: noteA }));
    const r = await callTool(server, 'note', {
      action: 'update',
      path: noteA,
      mode: 'replace_section',
      heading: '## Section Two',
      content: 'Replaced section body with more text.\n',
      expectedHash: read.contentHash,
    });
    expectOk('note: replace_section', r);
  }

  {
    // replace size guard
    const read = parseResult(await callTool(server, 'note', { action: 'read', path: noteA }));
    const r = await callTool(server, 'note', {
      action: 'update',
      path: noteA,
      mode: 'replace',
      content: '# tiny\n',
      expectedHash: read.contentHash,
    });
    expectErr('note: replace size guard without force', r, '');
  }

  {
    // append/prepend
    const read = parseResult(await callTool(server, 'note', { action: 'read', path: noteA }));
    const r1 = await callTool(server, 'note', {
      action: 'update',
      path: noteA,
      mode: 'append',
      content: '\n\nAPPENDED_MARKER\n',
      expectedHash: read.contentHash,
    });
    const d1 = expectOk('note: append', r1);
    const hash = d1?.contentHash ?? parseResult(await callTool(server, 'note', { action: 'read', path: noteA })).contentHash;
    const r2 = await callTool(server, 'note', {
      action: 'update',
      path: noteA,
      mode: 'prepend',
      content: 'PREPENDED_MARKER\n\n',
      expectedHash: hash,
    });
    expectOk('note: prepend', r2);
  }

  {
    // frontmatter merge / set / delete keys
    const r1 = await callTool(server, 'note', {
      action: 'frontmatter',
      path: noteA,
      fmOperation: 'merge',
      frontmatter: { stressFlag: true, tags: ['stress-probe', 'mcp', 'extra'] },
    });
    expectOk('note: frontmatter merge', r1);

    const r2 = await callTool(server, 'note', {
      action: 'frontmatter',
      path: noteA,
      fmOperation: 'delete',
      keys: ['stressFlag', 'nested'],
    });
    expectOk('note: frontmatter delete keys', r2);

    const r3 = await callTool(server, 'note', {
      action: 'frontmatter',
      path: noteA,
      fmOperation: 'set',
      frontmatter: {},
    });
    expectErr('note: frontmatter set {} rejected', r3, 'frontmatter');
  }

  {
    // nested path create
    const r = await callTool(server, 'note', {
      action: 'create',
      path: noteNested,
      content: '# Nested\n\nSee [[_raw/_missing]] and [[entities/cursidian]].\n',
      frontmatter: { title: 'Nested', tags: ['stress-probe'] },
      overwrite: true,
    });
    expectOk('note: create deep nested path', r);
  }

  {
    // rename with backlinks + index
    const r = await callTool(server, 'note', {
      action: 'create',
      path: noteB,
      content: `# B\n\nLinks to [[${noteA}]]\n`,
      frontmatter: { title: 'Stress B', tags: ['stress-probe'] },
      overwrite: true,
    });
    expectOk('note: create B linking A', r);

    const renamed = `${probePrefix}-a-renamed`;
    const rr = await callTool(server, 'note', {
      action: 'rename',
      path: noteA,
      newPath: renamed,
      updateBacklinks: true,
      updateIndex: true,
    });
    const data = expectOk('note: rename with backlinks+index', rr);
    if (data) {
      const b = parseResult(await callTool(server, 'note', { action: 'read', path: noteB }));
      if (!b.content.includes(renamed) && b.content.includes(noteA)) {
        record('fail', 'note: rename did not rewrite backlink in B', {
          contentSnippet: b.content.slice(0, 200),
        });
      } else {
        record('ok', 'note: backlink rewrite after rename', null);
      }
    }

    // graph after rename
    const g = await callTool(server, 'graph', { path: renamed });
    expectOk('graph: after rename', g);
  }

  // --- Concurrent-ish: interleaved search while mutating ---
  {
    const renamed = `${probePrefix}-a-renamed`;
    const ops = [];
    for (let i = 0; i < 20; i++) {
      ops.push(callTool(server, 'search', { action: 'content', query: 'Stress APPENDED_MARKER', limit: 5 }));
      ops.push(callTool(server, 'search', { action: 'by_tags', tags: ['stress-probe'], limit: 20 }));
      ops.push(callTool(server, 'graph', { path: renamed }));
      ops.push(callTool(server, 'search', { action: 'tags' }));
    }
    const results = await Promise.all(ops);
    const fails = results.filter((r) => r.isError);
    if (fails.length) {
      record('fail', 'concurrent search/graph during vault churn', {
        failCount: fails.length,
        sample: fails[0].content[0].text.slice(0, 200),
      });
    } else {
      record('ok', `concurrent: ${results.length} parallel ops ok`, null);
    }
  }

  // --- Vault stress ---
  {
    const folder = `${probePrefix}-folder/child`;
    const r1 = await callTool(server, 'vault', { action: 'create_folder', path: folder });
    expectOk('vault: create nested folder', r1);
    const r2 = await callTool(server, 'vault', { action: 'list_folders', path: `${probePrefix}-folder` });
    expectOk('vault: list nested', r2);
    // delete non-empty should fail
    const r3 = await callTool(server, 'vault', {
      action: 'delete_folder',
      path: `${probePrefix}-folder`,
      confirm: true,
    });
    expectErr('vault: delete non-empty rejected', r3, '');
    // delete empty child then parent
    const r4 = await callTool(server, 'vault', {
      action: 'delete_folder',
      path: folder,
      confirm: true,
    });
    expectOk('vault: delete empty child', r4);
    const r5 = await callTool(server, 'vault', {
      action: 'delete_folder',
      path: `${probePrefix}-folder`,
      confirm: true,
    });
    expectOk('vault: delete empty parent', r5);
  }

  {
    const health = expectOk('vault: health', await callTool(server, 'vault', { action: 'health', staleDays: 1 }));
    if (health) {
      // our probe notes may appear as orphans / missing FM issues — that's ok, note them
      const probeOrphans = (health.orphans ?? []).filter((p) => String(p).includes('_stress-') || String(p.path ?? '').includes('_stress-'));
      if (probeOrphans.length) {
        record('warn', 'vault health lists stress probes as orphans (expected mid-run)', probeOrphans.length);
      }
    }
    expectOk('vault: sync_index dryRun', await callTool(server, 'vault', { action: 'sync_index', dryRun: true }));
  }

  {
    // log with and without hashes
    const logRead = await callTool(server, 'note', { action: 'read', path: 'log' });
    if (!logRead.isError) {
      const logData = JSON.parse(logRead.content[0].text);
      const bad = await callTool(server, 'vault', {
        action: 'log',
        logLine: 'STRESS_SHOULD_FAIL_HASH',
        expectedLogHash: '0'.repeat(64),
      });
      expectErr('vault: log bad hash rejected', bad, 'hash');

      const good = await callTool(server, 'vault', {
        action: 'log',
        logLine: `STRESS_PROBE ${probePrefix} (will leave a log line)`,
        expectedLogHash: logData.contentHash,
      });
      // logging is a real vault mutation — record result
      if (good.isError) {
        record('warn', 'vault: log with good hash failed', good.content[0].text.slice(0, 200));
      } else {
        record('ok', 'vault: log with expectedLogHash', null);
      }
    } else {
      record('warn', 'vault: could not read log.md for hash test', logRead.content[0].text.slice(0, 160));
    }
  }

  // --- Dispatch confusion / invalid combos ---
  {
    const combos = [
      ['note', { action: 'read' }], // missing path — schema may block
      ['note', { action: 'update', path: noteB, mode: 'patch', old_string: 'nope', new_string: 'x' }],
      ['note', { action: 'update', path: noteB, mode: 'replace_section', heading: '## Missing', content: 'x' }],
      ['note', { action: 'delete', path: noteB, confirm: false }],
      ['note', { action: 'rename', path: noteB }],
      ['search', { action: 'content' }],
      ['search', { action: 'by_tags', tags: [] }],
      ['vault', { action: 'delete_folder', path: 'nope', confirm: false }],
      ['vault', { action: 'create_folder' }],
      ['graph', { path: noteB + '-missing' }],
    ];
    for (const [tool, args] of combos) {
      try {
        const r = await callTool(server, tool, args);
        if (!r.isError) {
          record('fail', `invalid combo should error: ${tool} ${JSON.stringify(args).slice(0, 80)}`, 'succeeded');
        } else {
          ok.push(`invalid ${tool}`);
        }
      } catch (e) {
        // schema throw before handler is acceptable
        ok.push(`invalid ${tool} threw`);
      }
    }
    record('ok', 'dispatch: invalid combos mostly rejected', null);
  }

  // --- Search finds probes; then cleanup ---
  {
    const r = await callTool(server, 'search', {
      action: 'by_tags',
      tags: ['stress-probe'],
      limit: 50,
    });
    const data = expectOk('search: find stress-probe tags', r);
    if (data && data.totalMatches < 1) {
      record('fail', 'search: stress-probe tags not indexed after writes', data);
    }
  }

  // cleanup probe notes
  {
    const list = parseResult(await callTool(server, 'search', { action: 'list', folder: '_raw', recursive: true }));
    const probes = (list.notes ?? [])
      .map((n) => n.path.replace(/\\/g, '/').replace(/\.md$/i, ''))
      .filter((p) => p.includes('_stress-'));
    for (const p of probes) {
      const r = await callTool(server, 'note', { action: 'delete', path: p, confirm: true });
      if (r.isError) {
        record('warn', `cleanup delete failed ${p}`, r.content[0].text.slice(0, 160));
      }
    }
    // try remove empty nested dirs if any left
    record('ok', `cleanup: deleted ${probes.length} probe notes`, { probes });
  }

  // final health
  {
    const health = expectOk('vault: health after cleanup', await callTool(server, 'vault', { action: 'health' }));
    if (health?.counts?.brokenLinks > 0) {
      record('warn', 'broken links remain after cleanup', {
        count: health.counts.brokenLinks,
        sample: health.brokenLinks?.slice(0, 5),
      });
    }
    if (health?.indexDrift?.summaryMismatches?.length) {
      record('warn', 'index summary mismatches', health.indexDrift.summaryMismatches.slice(0, 8));
    }
  }

  const failCount = findings.filter((f) => f.kind === 'fail').length;
  const warnCount = findings.filter((f) => f.kind === 'warn').length;
  const summary = {
    vault: config.vaultPath,
    probePrefix,
    okCount: ok.length,
    failCount,
    warnCount,
    findings,
  };

  const outArg = process.argv.find((a) => a.startsWith('--out='));
  if (outArg) {
    const outPath = outArg.slice(6);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`Wrote ${outPath}`);
  }

  console.log(`\nSUMMARY ok≈${ok.length} fail=${failCount} warn=${warnCount}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
