/**
 * Multi-Model Benchmark
 *
 * Benchmarks multiple embedding models to find the best performer
 * for tool search accuracy and latency.
 */

import {
  createBM25Engine,
  createEmbeddingEngine,
  createRegexEngine,
  getAvailableFormats,
  type SearchMethod,
  type ToolDefinition,
} from "../search";
import type { EmbeddingFormat } from "../search/formats";
import {
  EMBEDDING_MODELS,
  ensureModelAvailable,
  getAllModelStatuses,
  getAvailableModels,
  printModelStatusTable,
} from "./models";

/**
 * Test case for benchmark.
 */
export interface BenchmarkTestCase {
  query: string;
  expectedTool: string;
  description?: string;
}

/**
 * Result for a single model/format/method combination.
 */
export interface BenchmarkResult {
  model?: string;
  format?: EmbeddingFormat;
  method: SearchMethod;
  accuracy: number;
  avgLatency: number;
  p95Latency: number;
  totalTests: number;
  passed: number;
  failed: number;
  avgRank: number;
  details: Array<{
    query: string;
    expectedTool: string;
    foundAtRank: number;
    latency: number;
    passed: boolean;
  }>;
}

/**
 * Full benchmark report.
 */
export interface ModelBenchmarkReport {
  timestamp: string;
  testCases: number;
  results: BenchmarkResult[];
  ranking: Array<{
    rank: number;
    method: SearchMethod;
    model?: string;
    format?: EmbeddingFormat;
    score: number;
    accuracy: number;
    avgLatency: number;
  }>;
  recommendations: string[];
}

/**
 * Standard test cases for quick benchmarking.
 */
export const QUICK_TEST_CASES: BenchmarkTestCase[] = [
  { query: "navigate to a URL", expectedTool: "playwright_browser_navigate" },
  { query: "click a button", expectedTool: "playwright_browser_click" },
  {
    query: "take a screenshot",
    expectedTool: "playwright_browser_take_screenshot",
  },
  { query: "type text into input", expectedTool: "playwright_browser_type" },
  { query: "list all projects", expectedTool: "plane_list_projects" },
  { query: "create a new issue", expectedTool: "plane_create_work_item" },
  { query: "search the web", expectedTool: "MiniMax_web_search" },
  {
    query: "convert to markdown",
    expectedTool: "markitdown_convert_to_markdown",
  },
  { query: "query documentation", expectedTool: "context7_query-docs" },
  { query: "close the browser", expectedTool: "playwright_browser_close" },
];

/**
 * Benchmark configuration.
 */
export interface BenchmarkConfig {
  testCases: BenchmarkTestCase[];
  tools: ToolDefinition[];
  models?: string[];
  formats?: EmbeddingFormat[];
  methods?: SearchMethod[];
  topK?: number;
  pullMissingModels?: boolean;
}

/**
 * Run a single benchmark iteration.
 */
async function runSingleBenchmark(
  method: SearchMethod,
  tools: ToolDefinition[],
  testCases: BenchmarkTestCase[],
  topK: number,
  model?: string,
  format?: EmbeddingFormat
): Promise<BenchmarkResult> {
  // Create the appropriate engine
  let engine: ReturnType<
    | typeof createEmbeddingEngine
    | typeof createBM25Engine
    | typeof createRegexEngine
  >;
  switch (method) {
    case "embedding":
      engine = createEmbeddingEngine(model, format);
      break;
    case "bm25":
      engine = createBM25Engine();
      break;
    case "regex":
      engine = createRegexEngine();
      break;
    default:
      throw new Error(`Unknown search method: ${method}`);
  }

  // Initialize engine
  await engine.initialize(tools, { model, format });

  const details: BenchmarkResult["details"] = [];
  const latencies: number[] = [];

  for (const testCase of testCases) {
    const startTime = Date.now();
    const results = await engine.search(testCase.query, topK);
    const latency = Date.now() - startTime;
    latencies.push(latency);

    const foundAtRank =
      results.findIndex((r) => r.name === testCase.expectedTool) + 1;
    const passed = foundAtRank > 0 && foundAtRank <= topK;

    details.push({
      query: testCase.query,
      expectedTool: testCase.expectedTool,
      foundAtRank: foundAtRank || -1,
      latency,
      passed,
    });
  }

  const passed = details.filter((d) => d.passed).length;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p95Index = Math.floor(sortedLatencies.length * 0.95);
  const p95Latency = sortedLatencies[p95Index] ?? sortedLatencies.at(-1);

  const ranksSum = details.reduce(
    (sum, d) => sum + (d.foundAtRank > 0 ? d.foundAtRank : topK + 1),
    0
  );
  const avgRank = ranksSum / details.length;

  return {
    model,
    format,
    method,
    accuracy: (passed / details.length) * 100,
    avgLatency: Number(avgLatency.toFixed(2)),
    p95Latency: Number(p95Latency.toFixed(2)),
    totalTests: details.length,
    passed,
    failed: details.length - passed,
    avgRank: Number(avgRank.toFixed(2)),
    details,
  };
}

/**
 * Run the full model benchmark.
 */
export async function runModelBenchmark(
  config: BenchmarkConfig
): Promise<ModelBenchmarkReport> {
  const { testCases, tools, topK = 5, pullMissingModels = false } = config;

  const methods = config.methods || ["embedding", "bm25", "regex"];
  const formats = config.formats || getAvailableFormats();

  // Check model availability
  console.log("\nChecking model availability...");
  const modelStatuses = await getAllModelStatuses();
  printModelStatusTable(modelStatuses);

  // Get available models or pull missing ones
  let models: string[];
  if (config.models) {
    models = config.models;
  } else {
    models = await getAvailableModels();
  }

  if (pullMissingModels && models.length < EMBEDDING_MODELS.length) {
    console.log("\nPulling missing models...");
    for (const model of EMBEDDING_MODELS) {
      if (!models.includes(model)) {
        const success = await ensureModelAvailable(model);
        if (success) {
          models.push(model);
        }
      }
    }
  }

  if (models.length === 0) {
    console.warn("No embedding models available. Only testing BM25 and Regex.");
  }

  const results: BenchmarkResult[] = [];
  const totalBenchmarks =
    (methods.includes("embedding") ? models.length * formats.length : 0) +
    (methods.includes("bm25") ? 1 : 0) +
    (methods.includes("regex") ? 1 : 0);

  let completed = 0;

  // Benchmark BM25
  if (methods.includes("bm25")) {
    console.log(`\n[${++completed}/${totalBenchmarks}] Benchmarking BM25...`);
    const result = await runSingleBenchmark("bm25", tools, testCases, topK);
    results.push(result);
    console.log(
      `  Accuracy: ${result.accuracy.toFixed(1)}%, Latency: ${result.avgLatency}ms`
    );
  }

  // Benchmark Regex
  if (methods.includes("regex")) {
    console.log(`\n[${++completed}/${totalBenchmarks}] Benchmarking Regex...`);
    const result = await runSingleBenchmark("regex", tools, testCases, topK);
    results.push(result);
    console.log(
      `  Accuracy: ${result.accuracy.toFixed(1)}%, Latency: ${result.avgLatency}ms`
    );
  }

  // Benchmark embeddings
  if (methods.includes("embedding")) {
    for (const model of models) {
      for (const format of formats) {
        console.log(
          `\n[${++completed}/${totalBenchmarks}] Benchmarking ${model} (${format})...`
        );
        try {
          const result = await runSingleBenchmark(
            "embedding",
            tools,
            testCases,
            topK,
            model,
            format
          );
          results.push(result);
          console.log(
            `  Accuracy: ${result.accuracy.toFixed(1)}%, Latency: ${result.avgLatency}ms`
          );
        } catch (error) {
          console.error(
            `  Error: ${error instanceof Error ? error.message : error}`
          );
        }
      }
    }
  }

  // Calculate ranking
  const ranking = results
    .map((r) => {
      // Score: accuracy * 0.7 + (100 - normalized_latency) * 0.2 + (topK - avgRank) * 10 * 0.1
      const maxLatency = Math.max(...results.map((x) => x.avgLatency));
      const normalizedLatency = (r.avgLatency / maxLatency) * 100;
      const rankScore = ((topK - r.avgRank + 1) / topK) * 100;
      const score =
        r.accuracy * 0.7 + (100 - normalizedLatency) * 0.2 + rankScore * 0.1;

      return {
        method: r.method,
        model: r.model,
        format: r.format,
        score: Number(score.toFixed(2)),
        accuracy: r.accuracy,
        avgLatency: r.avgLatency,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ rank: i + 1, ...r }));

  // Generate recommendations
  const recommendations: string[] = [];
  if (ranking.length > 0) {
    const best = ranking[0];
    recommendations.push(
      `Best overall: ${best.method}${best.model ? ` with ${best.model}` : ""}${best.format ? ` (${best.format} format)` : ""}`
    );
    recommendations.push(
      `  Score: ${best.score}, Accuracy: ${best.accuracy}%, Latency: ${best.avgLatency}ms`
    );

    // Find best accuracy
    const bestAccuracy = ranking.reduce((a, b) =>
      b.accuracy > a.accuracy ? b : a
    );
    if (bestAccuracy !== best) {
      recommendations.push(
        `Best accuracy: ${bestAccuracy.method}${bestAccuracy.model ? ` with ${bestAccuracy.model}` : ""} (${bestAccuracy.accuracy}%)`
      );
    }

    // Find fastest
    const fastest = ranking.reduce((a, b) =>
      b.avgLatency < a.avgLatency ? b : a
    );
    if (fastest !== best) {
      recommendations.push(
        `Fastest: ${fastest.method}${fastest.model ? ` with ${fastest.model}` : ""} (${fastest.avgLatency}ms)`
      );
    }
  }

  return {
    timestamp: new Date().toISOString(),
    testCases: testCases.length,
    results,
    ranking,
    recommendations,
  };
}

/**
 * Print benchmark report to console.
 */
export function printBenchmarkReport(report: ModelBenchmarkReport): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log("MODEL BENCHMARK REPORT");
  console.log("=".repeat(70));
  console.log(`Test cases: ${report.testCases}`);
  console.log(`Configurations tested: ${report.results.length}`);

  console.log(`\n${"-".repeat(70)}`);
  console.log("RANKING");
  console.log("-".repeat(70));

  for (const r of report.ranking.slice(0, 10)) {
    const name = r.model ? `${r.method}/${r.model}/${r.format}` : r.method;
    console.log(
      `  ${r.rank}. ${name.padEnd(45)} Score: ${r.score.toFixed(1).padStart(5)}, Acc: ${r.accuracy.toFixed(0).padStart(3)}%, Lat: ${r.avgLatency.toFixed(0).padStart(4)}ms`
    );
  }

  console.log(`\n${"-".repeat(70)}`);
  console.log("RECOMMENDATIONS");
  console.log("-".repeat(70));
  for (const rec of report.recommendations) {
    console.log(`  ${rec}`);
  }

  console.log(`\n${"=".repeat(70)}`);
}
