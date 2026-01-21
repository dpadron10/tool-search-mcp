/**
 * Ink-based Benchmark UI Component
 *
 * Interactive CLI UI for benchmark visualization using React and Ink.
 * Supports both interactive and non-interactive modes.
 */

import {
  Box,
  Newline,
  render,
  Spacer,
  Static,
  Text,
  useApp,
  useInput,
} from "ink";
import { useCallback, useEffect, useState } from "react";
import type { EmbeddingFormat } from "../search/formats";
import type { SearchMethod, ToolDefinition } from "../search/index";
import type { BenchmarkResult, ModelBenchmarkReport } from "./model-benchmark";

/**
 * Benchmark configuration for the UI
 */
export interface BenchmarkUiConfig {
  interactive?: boolean;
  onComplete?: (report: ModelBenchmarkReport) => void;
}

/**
 * Progress item for Static display
 */
interface ProgressItem {
  id: string;
  message: string;
  status: "pending" | "running" | "completed" | "error";
  timestamp: Date;
}

/**
 * Winning configuration stored in history
 */
export interface WinningConfig {
  timestamp: string;
  method: SearchMethod;
  model?: string;
  format?: EmbeddingFormat;
  accuracy: number;
  avgLatency: number;
  score: number;
  testCases: number;
}

/**
 * Main benchmark UI component
 */
function BenchmarkUi({
  config,
  tools,
  testCases,
  methods,
  formats,
  models,
  onComplete,
}: {
  config: BenchmarkUiConfig;
  tools: ToolDefinition[];
  testCases: Array<{ query: string; expectedTool: string }>;
  methods: SearchMethod[];
  formats: EmbeddingFormat[];
  models: string[];
  onComplete?: (report: ModelBenchmarkReport) => void;
}) {
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [history, setHistory] = useState<WinningConfig[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [benchmarkComplete, setBenchmarkComplete] = useState(false);
  const [finalReport, setFinalReport] = useState<ModelBenchmarkReport | null>(
    null
  );
  const { exit } = useApp();

  // Load history on mount
  useEffect(() => {
    const savedHistory = loadHistory();
    setHistory(savedHistory);
  }, []);

  // Handle keyboard input for interactive mode
  useInput(
    useCallback(
      (input, key) => {
        if (!config.interactive) return;

        if (input === "h") {
          setShowHistory(true);
        } else if (input === "q") {
          exit();
        } else if (input === "r") {
          setShowHistory(false);
        } else if (input === "c") {
          setShowHistory(false);
          setBenchmarkComplete(false);
          setResults([]);
          setProgress([]);
        }
      },
      [config.interactive, exit]
    )
  );

  // Add progress item
  const addProgress = useCallback(
    (id: string, message: string, status: ProgressItem["status"]) => {
      setProgress((prev) => [
        ...prev,
        { id, message, status, timestamp: new Date() },
      ]);
    },
    []
  );

  // Update progress item
  const updateProgress = useCallback(
    (id: string, message: string, status: ProgressItem["status"]) => {
      setProgress((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, message, status } : item
        )
      );
    },
    []
  );

  // Run the benchmark
  useEffect(() => {
    async function runBenchmark() {
      if (benchmarkComplete) return;

      // Add initial progress
      addProgress("start", "Initializing benchmark...", "running");

      try {
        // Import required modules dynamically
        const { runModelBenchmark } = await import("./model-benchmark");
        const { createEmbeddingEngine, createBM25Engine, createRegexEngine } =
          await import("../search/index");

        // Get available formats
        const { getAvailableFormats } = await import("../search/formats");

        const allFormats = formats.length > 0 ? formats : getAvailableFormats();
        const allModels = models.length > 0 ? models : ["embeddinggemma"];

        // Calculate total benchmarks
        const totalBenchmarks =
          (methods.includes("embedding")
            ? allModels.length * allFormats.length
            : 0) +
          (methods.includes("bm25") ? 1 : 0) +
          (methods.includes("regex") ? 1 : 0);

        let completed = 0;

        // Benchmark BM25
        if (methods.includes("bm25")) {
          setCurrentStep(
            `Benchmarking BM25... (${++completed}/${totalBenchmarks})`
          );
          updateProgress("start", "Benchmarking BM25...", "running");

          const engine = createBM25Engine();
          await engine.initialize(tools);

          const bm25Result = await runSingleBenchmarkTest(
            engine,
            "bm25",
            testCases,
            5
          );
          setResults((prev) => [...prev, bm25Result]);
          updateProgress(
            "bm25",
            `BM25: ${bm25Result.accuracy.toFixed(1)}% accuracy, ${bm25Result.avgLatency}ms latency`,
            "completed"
          );
        }

        // Benchmark Regex
        if (methods.includes("regex")) {
          setCurrentStep(
            `Benchmarking Regex... (${++completed}/${totalBenchmarks})`
          );
          updateProgress("regex", "Benchmarking Regex...", "running");

          const engine = createRegexEngine();
          await engine.initialize(tools);

          const regexResult = await runSingleBenchmarkTest(
            engine,
            "regex",
            testCases,
            5
          );
          setResults((prev) => [...prev, regexResult]);
          updateProgress(
            "regex",
            `Regex: ${regexResult.accuracy.toFixed(1)}% accuracy, ${regexResult.avgLatency}ms latency`,
            "completed"
          );
        }

        // Benchmark embeddings
        if (methods.includes("embedding")) {
          for (const model of allModels) {
            for (const format of allFormats) {
              setCurrentStep(
                `Benchmarking ${model} (${format})... (${++completed}/${totalBenchmarks})`
              );
              const progressId = `embedding-${model}-${format}`;
              addProgress(
                progressId,
                `Benchmarking ${model} (${format})...`,
                "running"
              );

              try {
                const engine = createEmbeddingEngine(model, format);
                await engine.initialize(tools, { model, format });

                const result = await runSingleBenchmarkTest(
                  engine,
                  "embedding",
                  testCases,
                  5,
                  model,
                  format
                );
                setResults((prev) => [...prev, result]);
                updateProgress(
                  progressId,
                  `${model} (${format}): ${result.accuracy.toFixed(1)}% accuracy, ${result.avgLatency}ms latency`,
                  "completed"
                );
              } catch (error) {
                updateProgress(
                  progressId,
                  `Error: ${error instanceof Error ? error.message : error}`,
                  "error"
                );
              }
            }
          }
        }

        // Calculate ranking and generate report
        setCurrentStep("Calculating results...");
        const ranking = calculateRanking(results, 5);
        const recommendations = generateRecommendations(ranking);

        const report: ModelBenchmarkReport = {
          timestamp: new Date().toISOString(),
          testCases: testCases.length,
          results,
          ranking,
          recommendations,
        };

        setFinalReport(report);

        // Save winning config to history
        if (ranking.length > 0) {
          const winningConfig: WinningConfig = {
            timestamp: report.timestamp,
            method: ranking[0].method,
            model: ranking[0].model,
            format: ranking[0].format,
            accuracy: ranking[0].accuracy,
            avgLatency: ranking[0].avgLatency,
            score: ranking[0].score,
            testCases: report.testCases,
          };

          const newHistory = [winningConfig, ...history].slice(0, 10);
          setHistory(newHistory);
          saveHistory(newHistory);
        }

        updateProgress("start", "Benchmark complete!", "completed");
        setBenchmarkComplete(true);

        if (onComplete) {
          onComplete(report);
        }
      } catch (error) {
        updateProgress(
          "start",
          `Error: ${error instanceof Error ? error.message : error}`,
          "error"
        );
      }
    }

    runBenchmark();
  }, [
    config.interactive,
    tools,
    testCases,
    methods,
    formats,
    models,
    onComplete,
    addProgress,
    updateProgress,
    history,
  ]);

  // Calculate final ranking
  const ranking =
    finalReport?.ranking ||
    (results.length > 0 ? calculateRanking(results, 5) : []);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          Tool Search MCP Benchmark
        </Text>
        <Text dimColor>{new Date().toLocaleString()}</Text>
      </Box>

      <Newline />

      {/* Progress section */}
      {!benchmarkComplete && (
        <Box flexDirection="column">
          <Text bold color="yellow">
            Running Benchmark...
          </Text>
          <Text>{currentStep}</Text>
          <Newline />
        </Box>
      )}

      {/* Results section */}
      {benchmarkComplete && finalReport && (
        <Box flexDirection="column">
          <Text bold color="green">
            Benchmark Complete!
          </Text>
          <Newline />

          {/* Ranking */}
          <Box flexDirection="column" marginBottom={1}>
            <Text bold underline>
              Top Configurations
            </Text>
            {ranking.slice(0, 5).map((r, i) => (
              <Box key={i}>
                <Text>
                  {i + 1}. {r.method}
                  {r.model ? `/${r.model}` : ""}
                  {r.format ? ` (${r.format})` : ""}
                </Text>
                <Spacer />
                <Text
                  color={
                    r.accuracy >= 80
                      ? "green"
                      : r.accuracy >= 50
                        ? "yellow"
                        : "red"
                  }
                >
                  {r.accuracy.toFixed(1)}% | {r.avgLatency}ms | Score:{" "}
                  {r.score.toFixed(1)}
                </Text>
              </Box>
            ))}
          </Box>

          <Newline />

          {/* Winning config */}
          {ranking.length > 0 && (
            <Box
              borderColor="green"
              borderStyle="round"
              flexDirection="column"
              marginBottom={1}
              padding={1}
            >
              <Text bold color="green">
                Winning Configuration
              </Text>
              <Text>
                Method: {ranking[0].method}
                {ranking[0].model && ` with ${ranking[0].model}`}
                {ranking[0].format && ` (${ranking[0].format} format)`}
              </Text>
              <Text>Accuracy: {ranking[0].accuracy.toFixed(1)}%</Text>
              <Text>Latency: {ranking[0].avgLatency}ms</Text>
              <Text>Score: {ranking[0].score.toFixed(1)}</Text>
            </Box>
          )}

          <Newline />

          {/* Recommendations */}
          <Box flexDirection="column" marginBottom={1}>
            <Text bold underline>
              Recommendations
            </Text>
            {finalReport.recommendations.map((rec, i) => (
              <Text key={i}>• {rec}</Text>
            ))}
          </Box>

          <Newline />

          {/* Interactive hints */}
          {config.interactive && (
            <Text dimColor>[H] View History | [C] Run Again | [Q] Quit</Text>
          )}
        </Box>
      )}

      {/* Progress log */}
      {progress.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>
            Progress Log
          </Text>
          <Static items={progress.filter((p) => p.status !== "pending")}>
            {(item) => (
              <Box>
                <Text
                  color={
                    item.status === "error"
                      ? "red"
                      : item.status === "completed"
                        ? "green"
                        : "yellow"
                  }
                >
                  {item.status === "running"
                    ? "●"
                    : item.status === "completed"
                      ? "✓"
                      : item.status === "error"
                        ? "✗"
                        : "○"}
                </Text>
                <Text> {item.message}</Text>
              </Box>
            )}
          </Static>
        </Box>
      )}

      {/* History overlay */}
      {showHistory && (
        <Box
          backgroundColor="black"
          bottom={0}
          flexDirection="column"
          left={0}
          padding={2}
          position="absolute"
          right={0}
          top={0}
        >
          <Text bold color="cyan" inverse>
            Benchmark History
          </Text>
          <Newline />
          <Text>Winning configurations from previous runs:</Text>
          <Newline />
          {history.length === 0 ? (
            <Text dimColor>No history yet. Run a benchmark first!</Text>
          ) : (
            history.map((config, i) => (
              <Box flexDirection="column" key={i} marginBottom={1}>
                <Text>
                  {i + 1}. {config.method}
                  {config.model ? `/${config.model}` : ""}
                  {config.format ? ` (${config.format})` : ""}
                </Text>
                <Text dimColor>
                  {new Date(config.timestamp).toLocaleString()} | Acc:{" "}
                  {config.accuracy.toFixed(1)}% | Lat: {config.avgLatency}ms
                </Text>
              </Box>
            ))
          )}
          <Newline />
          <Text dimColor>[R] Return to results</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Run a single benchmark test
 */
async function runSingleBenchmarkTest(
  engine: {
    search: (query: string, topK: number) => Promise<Array<{ name: string }>>;
  },
  method: SearchMethod,
  testCases: Array<{ query: string; expectedTool: string }>,
  topK: number,
  model?: string,
  format?: EmbeddingFormat
): Promise<BenchmarkResult> {
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
 * Calculate ranking from results
 */
function calculateRanking(
  results: BenchmarkResult[],
  topK: number
): ModelBenchmarkReport["ranking"] {
  return results
    .map((r) => {
      const maxLatency = Math.max(...results.map((x) => x.avgLatency), 1);
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
}

/**
 * Generate recommendations from ranking
 */
function generateRecommendations(
  ranking: ModelBenchmarkReport["ranking"]
): string[] {
  const recommendations: string[] = [];

  if (ranking.length > 0) {
    const best = ranking[0];
    recommendations.push(
      `Best overall: ${best.method}${best.model ? ` with ${best.model}` : ""}${best.format ? ` (${best.format} format)` : ""}`
    );
    recommendations.push(
      `  Score: ${best.score}, Accuracy: ${best.accuracy}%, Latency: ${best.avgLatency}ms`
    );

    const bestAccuracy = ranking.reduce((a, b) =>
      b.accuracy > a.accuracy ? b : a
    );
    if (bestAccuracy !== best) {
      recommendations.push(
        `Best accuracy: ${bestAccuracy.method}${bestAccuracy.model ? ` with ${bestAccuracy.model}` : ""} (${bestAccuracy.accuracy}%)`
      );
    }

    const fastest = ranking.reduce((a, b) =>
      b.avgLatency < a.avgLatency ? b : a
    );
    if (fastest !== best) {
      recommendations.push(
        `Fastest: ${fastest.method}${fastest.model ? ` with ${fastest.model}` : ""} (${fastest.avgLatency}ms)`
      );
    }
  }

  return recommendations;
}

/**
 * History storage
 */
const HISTORY_FILE = `${process.env.HOME}/.tool-search-benchmark-history.json`;

function loadHistory(): WinningConfig[] {
  try {
    const { readFileSync } = require("node:fs");
    if (require("node:fs").existsSync(HISTORY_FILE)) {
      const content = readFileSync(HISTORY_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch {
    // Ignore errors
  }
  return [];
}

function saveHistory(history: WinningConfig[]): void {
  try {
    const { writeFileSync, mkdirSync, existsSync } = require("node:fs");
    const path = require("node:path");

    const dir = path.dirname(HISTORY_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch {
    // Ignore errors
  }
}

/**
 * Run the benchmark with Ink UI
 */
export async function runBenchmarkWithUi(options: {
  tools: ToolDefinition[];
  testCases: Array<{ query: string; expectedTool: string }>;
  methods?: SearchMethod[];
  formats?: EmbeddingFormat[];
  models?: string[];
  interactive?: boolean;
  onComplete?: (report: ModelBenchmarkReport) => void;
}): Promise<ModelBenchmarkReport | null> {
  const {
    tools,
    testCases,
    methods = ["embedding", "bm25", "regex"],
    formats = [],
    models = [],
    interactive = true,
    onComplete,
  } = options;

  if (!interactive) {
    // Non-interactive mode: run benchmark without UI
    const { runModelBenchmark, QUICK_TEST_CASES } = await import(
      "./model-benchmark"
    );

    const report = await runModelBenchmark({
      testCases: testCases || QUICK_TEST_CASES,
      tools,
      methods,
      formats: formats as Array<
        "minimal" | "standard" | "rich" | "verbose" | "structured"
      >,
      models: models.length > 0 ? models : undefined,
    });

    return report;
  }

  // Interactive mode: use Ink UI
  return new Promise((resolve) => {
    const app = render(
      <BenchmarkUi
        config={{ interactive: true, onComplete }}
        formats={formats}
        methods={methods}
        models={models}
        onComplete={(report) => {
          resolve(report);
        }}
        testCases={testCases}
        tools={tools}
      />
    );

    // Cleanup on exit
    return () => {
      app.unmount();
    };
  });
}

/**
 * Display benchmark results in non-interactive mode
 */
export function displayBenchmarkResults(report: ModelBenchmarkReport): void {
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

  // Display history
  const history = loadHistory();
  if (history.length > 0) {
    console.log(`\n${"-".repeat(70)}`);
    console.log("BENCHMARK HISTORY");
    console.log("-".repeat(70));
    history.forEach((config, i) => {
      console.log(
        `${i + 1}. ${config.method}${config.model ? `/${config.model}` : ""}${config.format ? ` (${config.format})` : ""} - Acc: ${config.accuracy.toFixed(1)}%, Lat: ${config.avgLatency}ms`
      );
    });
    console.log(`\n${"=".repeat(70)}`);
  }
}
