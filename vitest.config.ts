import { defineConfig } from 'vitest/config';

const isSubsetRun = process.argv.some((arg) => arg.includes('.test.'));
const coverageThresholds = isSubsetRun
  ? undefined
  : {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    };

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/server.ts', 'src/config.ts'],
      thresholds: coverageThresholds,
    },
  },
});
