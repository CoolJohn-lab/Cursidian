import fs from 'node:fs/promises';
import path from 'node:path';

const BASELINE_PATH = path.join('tests', 'benchmarks', 'baselines.json');

async function timeCall(label, fn) {
  const started = performance.now();
  const result = await fn();
  const ms = performance.now() - started;
  return { label, ms: Math.round(ms * 100) / 100, meta: result };
}

export async function runBenchmarkSuite(ctx) {
  const { createTestServer, callTool, parseResult, runCase, resetCaches, options } = ctx;
  const { server } = await createTestServer();
  const results = [];
  const timings = [];

  const cases = [
    {
      label: 'search.list.root',
      run: async () => {
        resetCaches();
        return parseResult(await callTool(server, 'search', { action: 'list', folder: '' }));
      },
    },
    {
      label: 'search.content.adf_pipeline',
      run: async () => {
        resetCaches();
        return parseResult(
          await callTool(server, 'search', { action: 'content', query: 'ADF pipeline', limit: 20 }),
        );
      },
    },
    {
      label: 'search.content.cached_repeat',
      run: async () => {
        return parseResult(
          await callTool(server, 'search', { action: 'content', query: 'ADF pipeline', limit: 20 }),
        );
      },
    },
    {
      label: 'search.content.factpublicholiday',
      run: async () => {
        resetCaches();
        return parseResult(
          await callTool(server, 'search', {
            action: 'content',
            query: 'FactPublicHoliday',
            limit: 10,
          }),
        );
      },
    },
    {
      label: 'note.read.index',
      run: async () => {
        resetCaches();
        return parseResult(await callTool(server, 'note', { action: 'read', path: 'index' }));
      },
    },
    {
      label: 'graph.project_hub',
      run: async () => {
        resetCaches();
        return parseResult(
          await callTool(server, 'graph', {
            path: 'projects/data-platform-dlz/data-platform-dlz',
          }),
        );
      },
    },
  ];

  for (const testCase of cases) {
    results.push(
      await runCase(
        `benchmark ${testCase.label}`,
        async () => {
          const timed = await timeCall(testCase.label, testCase.run);
          timings.push(timed);
          console.log(`      ${timed.label}: ${timed.ms}ms`);
        },
        ctx,
      ),
    );
  }

  const coldSearch = timings.find((t) => t.label === 'search.content.adf_pipeline');
  const cachedSearch = timings.find((t) => t.label === 'search.content.cached_repeat');
  // True cache hits (see case order) should be far below cold search latency.
  const cachedColdRatioMax = 0.1;
  results.push(
    await runCase(
      'benchmark cached faster than cold',
      async () => {
        if (!coldSearch || !cachedSearch) {
          throw new Error('missing cold or cached benchmark timings');
        }
        if (cachedSearch.ms >= coldSearch.ms * cachedColdRatioMax) {
          throw new Error(
            `cached ${cachedSearch.ms}ms should be < ${cachedColdRatioMax * 100}% of cold ${coldSearch.ms}ms`,
          );
        }
      },
      ctx,
    ),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    vaultPath: process.env.OBSIDIAN_VAULT_PATH,
    timings: timings.map(({ label, ms }) => ({ label, ms })),
  };

  if (options['save-baseline']) {
    await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true });
    await fs.writeFile(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    console.log(`\nBaseline saved to ${BASELINE_PATH}`);
  } else {
    try {
      const raw = await fs.readFile(BASELINE_PATH, 'utf-8');
      const baseline = JSON.parse(raw);
      console.log('\nComparison vs baseline:');
      for (const current of timings) {
        const previous = baseline.timings?.find((t) => t.label === current.label);
        if (!previous) {
          console.log(`  ${current.label}: ${current.ms}ms (no baseline)`);
          continue;
        }
        const delta = Math.round((current.ms - previous.ms) * 100) / 100;
        const pct = previous.ms > 0 ? Math.round((delta / previous.ms) * 100) : 0;
        console.log(
          `  ${current.label}: ${current.ms}ms (${delta >= 0 ? '+' : ''}${delta}ms, ${pct}%)`,
        );
      }
    } catch {
      console.log(`\nNo baseline at ${BASELINE_PATH}. Run with --save-baseline to create one.`);
    }
  }

  return { results, timings };
}
