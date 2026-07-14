/**
 * Computes p50 and p95 from an array of millisecond timings.
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Summarises timing samples with count, p50, p95, min, max.
 */
export function summariseTimings(samples) {
  const ms = samples.map((s) => s.ms);
  return {
    count: ms.length,
    p50: Math.round(percentile(ms, 50) * 100) / 100,
    p95: Math.round(percentile(ms, 95) * 100) / 100,
    min: ms.length ? Math.round(Math.min(...ms) * 100) / 100 : 0,
    max: ms.length ? Math.round(Math.max(...ms) * 100) / 100 : 0,
  };
}
