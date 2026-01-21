/**
 * Ink CLI Entry Point for Benchmark
 *
 * This is the main entry point for running the benchmark with Ink UI.
 * Run with: bun run benchmark:cli
 */

import { Box, Newline, render, Spacer, Text, useApp, useInput } from "ink";
import { useEffect, useState } from "react";
import type { EmbeddingFormat } from "../search/formats";
import type { SearchMethod, ToolDefinition } from "../search/index";
import type { ModelBenchmarkReport } from "./model-benchmark";

/**
 * Load MCP tools from configuration
 */
async function loadMcpToolsFromConfig(): Promise<ToolDefinition[]> {
  const { Client } = await import("@modelcontextprotocol/sdk/client");
  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );
  const fs = await import("node:fs/promises");

  const mcpTools: ToolDefinition[] = [];

  let mcpConfig: {
    mcpServers: Record<
      string,
      { command: string; args?: string[]; env?: Record<string, string> }
    >;
  } | null = null;

  const configPaths = [
    `${process.env.HOME}/.claude.json`,
    `${process.env.HOME}/.claude/mcp.json`,
    `${process.env.HOME}/.cursor/mcp.json`,
  ];

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      mcpConfig = JSON.parse(content);
      break;
    } catch {
      // Ignore
    }
  }

  if (!mcpConfig) {
    return [];
  }

  for (const [serverName, config] of Object.entries(mcpConfig.mcpServers)) {
    try {
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
      for (const [key, value] of Object.entries(config.env || {})) {
        if (value !== undefined) {
          env[key] = value;
        }
      }

      const serverParams = {
        command: config.command,
        args: config.args || [],
        env,
      };

      const transport = new StdioClientTransport(serverParams);
      const client = new Client({
        name: "benchmark-tool",
        version: "1.0.0",
      });

      await client.connect(transport);
      const result = await client.listTools();

      for (const tool of result.tools) {
        mcpTools.push({
          name: `${serverName}_${tool.name}`,
          description: tool.description || "",
          input_schema: {
            type: "object" as const,
            properties: (tool.inputSchema?.properties || {}) as Record<
              string,
              unknown
            >,
            required: tool.inputSchema?.required || [],
          },
        });
      }

      await client.close();
    } catch {
      // Skip this server
    }
  }

  return mcpTools;
}

/**
 * Winning configuration stored in history
 */
interface WinningConfig {
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
 * Progress item
 */
interface ProgressItem {
  id: string;
  message: string;
  status: "pending" | "running" | "completed" | "error";
  timestamp: Date;
}

/**
 * Main CLI App component
 */
function CliApp({
  methods,
  formats,
  models,
  all = true,
}: {
  methods: SearchMethod[];
  formats: EmbeddingFormat[];
  models?: string[];
  all?: boolean;
}) {
  const [step, setStep] = useState<string>("Initializing...");
  const [toolsLoaded, setToolsLoaded] = useState<number>(0);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [benchmarkComplete, setBenchmarkComplete] = useState(false);
  const [results, setResults] = useState<ModelBenchmarkReport | null>(null);
  const [tokenSavings, setTokenSavings] = useState<{
    baseline: number;
    dynamic: number;
    saved: number;
    percentage: number;
  } | null>(null);
  const [mcpResults, setMcpResults] = useState<
    Array<{ server: string; accuracy: number; tests: number; passed: number }>
  >([]);
  const [history, setHistory] = useState<WinningConfig[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const { exit } = useApp();

  // Load history on mount
  useEffect(() => {
    const savedHistory = loadHistory();
    setHistory(savedHistory);
  }, []);

  // Handle keyboard input
  useInput((input) => {
    if (input === "h") {
      setShowHistory(true);
    } else if (input === "r") {
      setShowHistory(false);
    } else if (input === "q") {
      exit();
    }
  });

  // Run benchmark on mount
  useEffect(() => {
    async function run() {
      try {
        setStep("Loading MCP tools...");
        addProgress("load-tools", "Loading MCP tools...", "running");

        const mcpTools = await loadMcpToolsFromConfig();

        if (mcpTools.length === 0) {
          setStep("Error: No MCP tools found. Check your configuration.");
          updateProgress("load-tools", "No MCP tools found", "error");
          return;
        }

        setToolsLoaded(mcpTools.length);
        updateProgress(
          "load-tools",
          `Loaded ${mcpTools.length} tools`,
          "completed"
        );

        // Run token savings benchmark
        if (all) {
          setStep("Running token savings benchmark...");
          addProgress(
            "token-savings",
            "Running token savings benchmark...",
            "running"
          );

          try {
            const { calculateScenarioTokens } = await import("./calculator.js");
            const { formatTokens } = await import("./tokenizer.js");

            const tokens = await calculateScenarioTokens(mcpTools, {
              model: "claude-sonnet-4-5-20250929",
            });

            // Calculate dynamic scenario
            const dynamicTokens = await calculateScenarioTokens(
              mcpTools.slice(0, 3),
              { model: "claude-sonnet-4-5-20250929" }
            );

            const saved = tokens.totalTokens - dynamicTokens.totalTokens;
            const percentage = (saved / tokens.totalTokens) * 100;

            setTokenSavings({
              baseline: tokens.totalTokens,
              dynamic: dynamicTokens.totalTokens,
              saved,
              percentage,
            });

            updateProgress(
              "token-savings",
              `Token savings: ${formatTokens(saved)} (${percentage.toFixed(1)}%)`,
              "completed"
            );
          } catch (error) {
            updateProgress("token-savings", `Token savings: ${error}`, "error");
          }

          // Run detailed MCP tests
          setStep("Running MCP accuracy tests...");
          addProgress("mcp-tests", "Running MCP accuracy tests...", "running");

          try {
            const { loadPrePreparedTests, generateDynamicTests } = await import(
              "./tests/index.js"
            );
            const { UnifiedSearchService } = await import("../search/index.js");
            const { createEmbeddingEngine } = await import(
              "../search/embedding.js"
            );

            // Initialize search engine
            const searchService = new UnifiedSearchService();
            const embeddingEngine = createEmbeddingEngine(
              "nomic-embed-text-v2-moe",
              "standard"
            );
            searchService.registerEngine(embeddingEngine);
            searchService.setDefaultMethod("embedding");
            await searchService.initialize(mcpTools);

            // Get MCP servers
            const mcpServers = new Set<string>();
            for (const tool of mcpTools) {
              const prefix = tool.name.split("_")[0];
              if (prefix) mcpServers.add(prefix);
            }

            // Load tests
            const prePreparedTests = await loadPrePreparedTests(
              Array.from(mcpServers)
            );

            const serverResults: typeof mcpResults = [];
            let totalPassed = 0;
            let totalTests = 0;

            for (const serverName of mcpServers) {
              const serverTools = mcpTools.filter((t) =>
                t.name.startsWith(`${serverName}_`)
              );

              const serverTests = prePreparedTests.filter((t) =>
                t.expectedTools.some((et) => et.startsWith(`${serverName}_`))
              );

              let testsToRun = serverTests;
              if (serverTests.length === 0) {
                const dynamicTests = generateDynamicTests(
                  serverName,
                  serverTools
                );
                testsToRun = dynamicTests.map((dt) => ({
                  id: dt.query.slice(0, 20),
                  query: dt.query,
                  expectedTools: dt.expectedTools,
                  description: dt.description,
                }));
              }

              let passed = 0;
              for (const test of testsToRun) {
                const response = await searchService.search({
                  query: test.query,
                  topK: 3,
                });
                const foundTools = response.results.map((r) => r.name);
                if (test.expectedTools.every((et) => foundTools.includes(et))) {
                  passed++;
                }
              }

              totalPassed += passed;
              totalTests += testsToRun.length;

              serverResults.push({
                server: serverName,
                accuracy:
                  testsToRun.length > 0
                    ? (passed / testsToRun.length) * 100
                    : 0,
                tests: testsToRun.length,
                passed,
              });
            }

            setMcpResults(serverResults);
            updateProgress(
              "mcp-tests",
              `MCP tests: ${totalPassed}/${totalTests} passed`,
              "completed"
            );
          } catch (error) {
            updateProgress("mcp-tests", `MCP tests error: ${error}`, "error");
          }
        }

        // Run model benchmark with UI
        setStep("Running model benchmark...");
        addProgress("model-benchmark", "Running model benchmark...", "running");

        const { runBenchmarkWithUi, QUICK_TEST_CASES } = await import(
          "./ui.js"
        );

        const report = await runBenchmarkWithUi({
          tools: mcpTools,
          testCases: QUICK_TEST_CASES,
          methods,
          formats,
          models: models || ["nomic-embed-text-v2-moe"],
          interactive: true,
        });

        if (report) {
          setResults(report);
          setBenchmarkComplete(true);
          updateProgress(
            "model-benchmark",
            `Model benchmark complete: ${report.ranking[0]?.method}/${report.ranking[0]?.model || "N/A"}`,
            "completed"
          );
        }
      } catch (error) {
        setStep(`Error: ${error instanceof Error ? error.message : error}`);
      }
    }

    run();
  }, [methods, formats, models, all]);

  // Add progress item
  const addProgress = (
    id: string,
    message: string,
    status: ProgressItem["status"]
  ) => {
    setProgress((prev) => [
      ...prev,
      { id, message, status, timestamp: new Date() },
    ]);
  };

  // Update progress item
  const updateProgress = (
    id: string,
    message: string,
    status: ProgressItem["status"]
  ) => {
    setProgress((prev) =>
      prev.map((item) => (item.id === id ? { ...item, message, status } : item))
    );
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Tool Search MCP Benchmark
      </Text>
      <Text dimColor>{new Date().toLocaleString()}</Text>

      <Newline />

      {/* Current step */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={benchmarkComplete ? "green" : "yellow"}>
          {benchmarkComplete ? "Benchmark Complete!" : step}
        </Text>
        {!benchmarkComplete && <Text>Loading tools: {toolsLoaded}</Text>}
      </Box>

      {/* Token Savings */}
      {tokenSavings && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>
            Token Savings
          </Text>
          <Text>
            Baseline (all tools): {(tokenSavings.baseline / 1000).toFixed(1)}K
            tokens
          </Text>
          <Text>
            Dynamic (3 tools): {(tokenSavings.dynamic / 1000).toFixed(1)}K
            tokens
          </Text>
          <Text color="green">
            Saved: {(tokenSavings.saved / 1000).toFixed(1)}K tokens (
            {tokenSavings.percentage.toFixed(1)}%)
          </Text>
        </Box>
      )}

      {/* MCP Results */}
      {mcpResults.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>
            MCP Server Accuracy
          </Text>
          {mcpResults.map((r, i) => (
            <Box key={i}>
              <Text>{r.server}</Text>
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
                {r.passed}/{r.tests} ({r.accuracy.toFixed(0)}%)
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Results */}
      {benchmarkComplete && results && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold underline>
            Top Configurations
          </Text>
          {results.ranking.slice(0, 5).map((r, i) => (
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
                {r.accuracy.toFixed(0)}% | {r.avgLatency}ms |{" "}
                {r.score.toFixed(1)}
              </Text>
            </Box>
          ))}

          <Newline />

          {/* Winning config */}
          {results.ranking.length > 0 && (
            <Box
              borderColor="green"
              borderStyle="round"
              flexDirection="column"
              padding={1}
            >
              <Text bold color="green">
                Winning Configuration
              </Text>
              <Text>
                {results.ranking[0].method}
                {results.ranking[0].model && `/${results.ranking[0].model}`}
                {results.ranking[0].format && ` (${results.ranking[0].format})`}
              </Text>
              <Text>Accuracy: {results.ranking[0].accuracy.toFixed(0)}%</Text>
              <Text>Latency: {results.ranking[0].avgLatency}ms</Text>
              <Text>Score: {results.ranking[0].score.toFixed(1)}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Progress */}
      {progress.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>
            Progress
          </Text>
          {progress.map((p) => (
            <Text
              color={
                p.status === "error"
                  ? "red"
                  : p.status === "completed"
                    ? "green"
                    : "yellow"
              }
              key={p.id}
            >
              {p.status === "completed"
                ? "✓"
                : p.status === "error"
                  ? "✗"
                  : "●"}{" "}
              {p.message}
            </Text>
          ))}
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
                  {config.accuracy.toFixed(0)}% | Lat: {config.avgLatency}ms
                </Text>
              </Box>
            ))
          )}
          <Newline />
          <Text dimColor>[R] Return to results | [Q] Quit</Text>
        </Box>
      )}

      {/* Interactive hints */}
      {!showHistory && <Text dimColor>[H] View History | [Q] Quit</Text>}
    </Box>
  );
}

/**
 * History storage
 */
const HISTORY_FILE = `${process.env.HOME}/.tool-search-benchmark-history.json`;

function loadHistory(): WinningConfig[] {
  try {
    const { existsSync, readFileSync } = require("node:fs");
    if (existsSync(HISTORY_FILE)) {
      const content = readFileSync(HISTORY_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch {
    // Ignore errors
  }
  return [];
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  const all = !args.includes("--minimal");
  const methods: SearchMethod[] = args.includes("--methods")
    ? ["embedding", "bm25", "regex"]
    : ["embedding"];
  const formats: EmbeddingFormat[] = args.includes("--formats")
    ? ["minimal", "standard", "rich", "verbose", "structured"]
    : [];
  const models = args.includes("--models")
    ? [
        "nomic-embed-text",
        "mxbai-embed-large",
        "all-minilm",
        "snowflake-arctic-embed",
        "bge-large",
        "nomic-embed-text-v2-moe",
      ]
    : undefined;

  render(
    <CliApp all={all} formats={formats} methods={methods} models={models} />
  );
}

// Run if executed directly
main().catch(console.error);
