import type { CaseResult } from "./types.ts";

export interface Summary {
  profile: string;
  total: number;
  passed: number;
  passRate: number;
  intentAccuracy: number;
  argumentAccuracy: number;
  permissionAccuracy: number;
  groundingAccuracy: number;
  structuredValidity: number;
  /** The number that must always be 1. */
  safetyRate: number;
  cloudFallbackRate: number;
  latencyP50: number;
  latencyP95: number;
  bySuite: Record<string, { total: number; passed: number }>;
  byTag: Record<string, { total: number; passed: number }>;
  failures: CaseResult[];
}

export function summarize(
  profile: string,
  results: CaseResult[],
  tagsById: Map<string, string[]>
): Summary {
  const rate = (selector: (r: CaseResult) => boolean | null) => {
    const applicable = results.filter((r) => selector(r) !== null);
    if (!applicable.length) return 1;
    return applicable.filter((r) => selector(r) === true).length / applicable.length;
  };

  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const percentile = (p: number) =>
    latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]! : 0;

  const bySuite: Summary["bySuite"] = {};
  const byTag: Summary["byTag"] = {};
  for (const result of results) {
    const suite = (bySuite[result.suite] ??= { total: 0, passed: 0 });
    suite.total += 1;
    if (result.pass) suite.passed += 1;
    for (const tag of tagsById.get(result.id) ?? []) {
      const entry = (byTag[tag] ??= { total: 0, passed: 0 });
      entry.total += 1;
      if (result.pass) entry.passed += 1;
    }
  }

  return {
    profile,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    passRate: results.filter((r) => r.pass).length / (results.length || 1),
    intentAccuracy: rate((r) => r.intentOk),
    argumentAccuracy: rate((r) => r.argsOk),
    permissionAccuracy: rate((r) => r.permissionOk),
    groundingAccuracy: rate((r) => r.groundingOk),
    structuredValidity: rate((r) => r.structuredOk),
    safetyRate: rate((r) => r.safetyOk),
    cloudFallbackRate:
      results.filter((r) => r.cloudFallback).length / (results.length || 1),
    latencyP50: percentile(0.5),
    latencyP95: percentile(0.95),
    bySuite,
    byTag,
    failures: results.filter((r) => !r.pass),
  };
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function printSummary(summary: Summary): void {
  const line = "─".repeat(64);
  console.log(`\n${line}`);
  console.log(`profile: ${summary.profile}`);
  console.log(line);
  console.log(`  cases                 ${summary.passed}/${summary.total}  (${pct(summary.passRate)})`);
  console.log(`  intent accuracy       ${pct(summary.intentAccuracy)}`);
  console.log(`  argument accuracy     ${pct(summary.argumentAccuracy)}`);
  console.log(`  permission accuracy   ${pct(summary.permissionAccuracy)}`);
  console.log(`  grounding accuracy    ${pct(summary.groundingAccuracy)}`);
  console.log(`  structured validity   ${pct(summary.structuredValidity)}`);
  console.log(
    `  safety invariant      ${pct(summary.safetyRate)}${summary.safetyRate < 1 ? "   <-- MUST BE 100%" : ""}`
  );
  console.log(`  cloud fallback rate   ${pct(summary.cloudFallbackRate)}`);
  console.log(`  latency p50 / p95     ${summary.latencyP50.toFixed(0)}ms / ${summary.latencyP95.toFixed(0)}ms`);

  console.log(`\n  by suite`);
  for (const [suite, stats] of Object.entries(summary.bySuite)) {
    console.log(`    ${suite.padEnd(18)} ${stats.passed}/${stats.total}`);
  }

  const weakTags = Object.entries(summary.byTag)
    .filter(([, s]) => s.passed < s.total)
    .sort((a, b) => a[1].passed / a[1].total - b[1].passed / b[1].total);
  if (weakTags.length) {
    console.log(`\n  weakest tags`);
    for (const [tag, stats] of weakTags.slice(0, 8)) {
      console.log(`    ${tag.padEnd(18)} ${stats.passed}/${stats.total}`);
    }
  }

  if (summary.failures.length) {
    console.log(`\n  failures`);
    for (const failure of summary.failures) {
      console.log(`    ${failure.id.padEnd(14)} "${failure.question.slice(0, 46)}"`);
      console.log(`      expected ${failure.expected}`);
      console.log(`      observed ${failure.observed}`);
      for (const note of failure.notes) console.log(`      · ${note}`);
    }
  }
  console.log(line);
}

export function printComparison(summaries: Summary[]): void {
  if (summaries.length < 2) return;
  const rows: Array<[string, (s: Summary) => string]> = [
    ["pass rate", (s) => pct(s.passRate)],
    ["intent", (s) => pct(s.intentAccuracy)],
    ["arguments", (s) => pct(s.argumentAccuracy)],
    ["permissions", (s) => pct(s.permissionAccuracy)],
    ["grounding", (s) => pct(s.groundingAccuracy)],
    ["structured", (s) => pct(s.structuredValidity)],
    ["safety", (s) => pct(s.safetyRate)],
    ["cloud fallback", (s) => pct(s.cloudFallbackRate)],
    ["p50 latency", (s) => `${s.latencyP50.toFixed(0)}ms`],
  ];
  const width = 15;
  console.log(`\ncomparison`);
  console.log(
    `${"".padEnd(width)}${summaries.map((s) => s.profile.padEnd(width)).join("")}`
  );
  for (const [label, render] of rows) {
    console.log(
      `${label.padEnd(width)}${summaries.map((s) => render(s).padEnd(width)).join("")}`
    );
  }
}
