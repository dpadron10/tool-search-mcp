#!/usr/bin/env bun
/**
 * Tool Search MCP Benchmark
 *
 * Single entrypoint for all benchmark modes:
 *
 * DEFAULT: Quick Mode (bun run benchmark)
 * - Tests 1 embedding model + BM25 + Regex
 * - Real-world tests per MCP server
 * - Vitest-style pass/fail output
 * - Recommends best method
 * - Shows confidence to replace traditional method
 *
 * FULL Mode (bun run benchmark --full)
 * - Comprehensive benchmark with all embedding models
 * - All embedding formats
 * - Token usage comparison
 * - Cost projections
 *
 * Run: bun run benchmark [options]
 *
 * Options:
 *   --full             Run comprehensive benchmark with all models/formats
 *   --extended, -e     Run extended tests (all tools, not just 1 per MCP)
 *   --claude, -c       Validate with real Claude CLI (costs API credits)
 *   --verbose, -v      Show detailed test results
 *   --help, -h         Show help
 */

import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createBM25Engine,
  createEmbeddingEngine,
  createRegexEngine,
  type SearchMethod,
  type ToolDefinition,
  UnifiedSearchService,
} from "../search";
import type { EmbeddingFormat } from "../search/formats";
import { getAvailableFormats } from "../search/formats";
import { type E2ETestCase, loadAllTests, loadPrimaryTests } from "./tests";

// Default embedding model
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text-v2-moe";

/**
 * CLI arguments interface.
 */
interface CliArgs {
  full: boolean;
  extended: boolean;
  claudeValidation: boolean;
  verbose: boolean;
  help: boolean;
}

/**
 * Parse CLI arguments.
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  return {
    full: args.includes("--full") || args.includes("-f"),
    extended: args.includes("--extended") || args.includes("-e"),
    claudeValidation: args.includes("--claude") || args.includes("-c"),
    verbose: args.includes("--verbose") || args.includes("-v"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

/**
 * Print help message.
 */
function printHelp(): void {
  console.log(`
Tool Search MCP Benchmark

Usage: bun run benchmark [options]

By default, runs quick benchmark to validate tool search accuracy.

Options:
  --full, -f          Run comprehensive benchmark with all models/formats
  --extended, -e      Run extended tests (all tools per MCP, not just primary)
  --claude, -c        Validate with real Claude CLI (costs API credits)
  --verbose, -v       Show detailed test results for each test case
  --help, -h          Show this help message

Examples:
  bun run benchmark                    # Quick benchmark (default)
  bun run benchmark -v                 # With detailed output
  bun run benchmark -e                 # Extended tests (all tools)
  bun run benchmark -c                 # With Claude CLI validation
  bun run benchmark --full             # Comprehensive benchmark
  bun run benchmark -e -c -v           # Extended + Claude + verbose
`);
}

/**
 * MCP server configuration interface.
 */
interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * MCP configuration interface.
 */
interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * Get config file paths for all platforms.
 */
function getConfigPaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const paths: string[] = [];

  // Linux/macOS paths
  paths.push(`${home}/.claude.json`);
  paths.push(`${home}/.claude/mcp.json`);
  paths.push(`${home}/.cursor/mcp.json`);
  paths.push(`${home}/.tool-search-mcp.jsonc`);
  paths.push(`${home}/.tool-search-mcp.json`);

  // Windows paths (when running on Windows)
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || "";
    paths.push(`${appData}\\Claude\\claude.json`);
    paths.push(`${appData}\\Claude\\mcp.json`);
  }

  return paths;
}

/**
 * Strip JSONC comments safely (handles strings containing // or /*)
 */
function stripJsoncComments(content: string): string {
  let result = "";
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    // Handle string state
    if (!(inSingleLineComment || inMultiLineComment)) {
      if (char === '"' && content[i - 1] !== "\\") {
        inString = !inString;
        result += char;
        i++;
        continue;
      }

      if (inString) {
        result += char;
        i++;
        continue;
      }

      // Check for comment start
      if (char === "/" && nextChar === "/") {
        inSingleLineComment = true;
        i += 2;
        continue;
      }

      if (char === "/" && nextChar === "*") {
        inMultiLineComment = true;
        i += 2;
        continue;
      }

      result += char;
      i++;
      continue;
    }

    // Handle single line comment
    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        result += char;
      }
      i++;
      continue;
    }

    // Handle multi line comment
    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      i++;
    }
  }

  return result;
}

/**
 * Attempts to load MCP config from various sources.
 */
export async function loadMcpConfig(): Promise<McpConfig | null> {
  const fs = await import("node:fs/promises");

  // Try environment variables first
  const envConfigs = [
    process.env.CLAUDE_CODE_MCP_CONFIG,
    process.env.CURSOR_MCP_CONFIG,
  ].filter(Boolean);

  for (const config of envConfigs) {
    try {
      if (config) {
        return JSON.parse(config) as McpConfig;
      }
    } catch {
      // ignore
    }
  }

  // Try config file locations
  for (const configPath of getConfigPaths()) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const stripped = stripJsoncComments(content);
      return JSON.parse(stripped) as McpConfig;
    } catch {
      // Ignore file not found errors
    }
  }

  return null;
}

/**
 * Connects to an MCP server and retrieves all available tools.
 */
export async function getToolsFromMcpServer(
  serverName: string,
  config: McpServerConfig
): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];

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

  const serverParams: StdioServerParameters = {
    command: config.command,
    args: config.args || [],
    env,
  };

  const transport = new StdioClientTransport(serverParams);
  const client = new Client({
    name: "benchmark",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();

    for (const tool of result.tools) {
      tools.push({
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

    console.log(`  ${serverName}: ${result.tools.length} tools`);
  } catch (error) {
    console.error(`  ${serverName}: Failed - ${error}`);
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }

  return tools;
}

/**
 * ANSI color codes for terminal output.
 */
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
};

/**
 * Test result for a single test case.
 */
interface TestResult {
  id: string;
  mcpServer: string;
  userPrompt: string;
  passed: boolean;
  foundTools: string[];
  expectedTools: string[];
  missingTools: string[];
  searchTimeMs: number;
  method: SearchMethod;
  rank: number;
}

/**
 * Method benchmark result.
 */
interface MethodResult {
  method: SearchMethod;
  model?: string;
  passed: number;
  failed: number;
  total: number;
  accuracy: number;
  avgSearchTimeMs: number;
  avgRank: number;
  results: TestResult[];
}

/**
 * Run a single test case with a specific search method.
 */
async function runSingleTest(
  test: E2ETestCase,
  searchService: UnifiedSearchService,
  method: SearchMethod,
  topK = 5
): Promise<TestResult> {
  const startTime = Date.now();

  try {
    const response = await searchService.search({
      query: test.userPrompt,
      method,
      topK,
    });

    const searchTimeMs = Date.now() - startTime;
    const foundTools = response.results.map((r) => r.name);

    // Check if ALL expected tools are in the results
    const missingTools = test.expectedTools.filter(
      (t) => !foundTools.includes(t)
    );
    const passed = missingTools.length === 0;

    // Find the rank of the first expected tool
    const firstExpectedIdx = test.expectedTools
      .map((t) => foundTools.indexOf(t))
      .filter((i) => i !== -1)
      .sort((a, b) => a - b)[0];
    const rank = firstExpectedIdx !== undefined ? firstExpectedIdx + 1 : -1;

    return {
      id: test.id,
      mcpServer: test.mcpServer,
      userPrompt: test.userPrompt,
      passed,
      foundTools,
      expectedTools: test.expectedTools,
      missingTools,
      searchTimeMs,
      method,
      rank: passed ? rank : -1,
    };
  } catch {
    return {
      id: test.id,
      mcpServer: test.mcpServer,
      userPrompt: test.userPrompt,
      passed: false,
      foundTools: [],
      expectedTools: test.expectedTools,
      missingTools: test.expectedTools,
      searchTimeMs: Date.now() - startTime,
      method,
      rank: -1,
    };
  }
}

/**
 * Print vitest-style test result line.
 */
function printTestResult(result: TestResult): void {
  const icon = result.passed
    ? `${colors.green}✓${colors.reset}`
    : `${colors.red}✗${colors.reset}`;
  const status = result.passed
    ? `${colors.green}PASS${colors.reset}`
    : `${colors.red}FAIL${colors.reset}`;
  const time = `${colors.dim}${result.searchTimeMs}ms${colors.reset}`;
  const prompt =
    result.userPrompt.length > 50
      ? `${result.userPrompt.slice(0, 50)}...`
      : result.userPrompt;

  console.log(
    `  ${icon} ${status} ${colors.dim}|${colors.reset} ${result.mcpServer} ${colors.dim}|${colors.reset} ${prompt} ${time}`
  );

  if (!result.passed) {
    console.log(
      `    ${colors.red}Missing: ${result.missingTools.join(", ")}${colors.reset}`
    );
    console.log(
      `    ${colors.dim}Found: ${result.foundTools.slice(0, 5).join(", ")}${colors.reset}`
    );
  }
}

/**
 * Run benchmark for a specific search method.
 */
async function benchmarkMethod(
  tests: E2ETestCase[],
  tools: ToolDefinition[],
  method: SearchMethod,
  model?: string,
  verbose = false
): Promise<MethodResult> {
  const searchService = new UnifiedSearchService();

  if (method === "embedding") {
    const engine = createEmbeddingEngine(model, "rich");
    searchService.registerEngine(engine);
  } else if (method === "bm25") {
    searchService.registerEngine(createBM25Engine());
  } else {
    searchService.registerEngine(createRegexEngine());
  }

  await searchService.initializeEngine(method, tools, {
    model,
    format: "rich",
  });
  searchService.setDefaultMethod(method);

  const results: TestResult[] = [];
  let totalSearchTime = 0;
  let totalRank = 0;
  let rankedCount = 0;

  for (const test of tests) {
    const result = await runSingleTest(test, searchService, method);
    results.push(result);
    totalSearchTime += result.searchTimeMs;

    if (result.rank > 0) {
      totalRank += result.rank;
      rankedCount++;
    }

    if (verbose) {
      printTestResult(result);
    }
  }

  const passed = results.filter((r) => r.passed).length;

  return {
    method,
    model,
    passed,
    failed: results.length - passed,
    total: results.length,
    accuracy: results.length > 0 ? (passed / results.length) * 100 : 0,
    avgSearchTimeMs: results.length > 0 ? totalSearchTime / results.length : 0,
    avgRank: rankedCount > 0 ? totalRank / rankedCount : 0,
    results,
  };
}

/**
 * Detect which tools are called in Claude CLI output.
 */
function detectToolCallsFromOutput(
  output: string,
  availableTools: string[]
): string[] {
  const calledTools: string[] = [];
  const lowerOutput = output.toLowerCase();

  for (const tool of availableTools) {
    const toolName = tool.toLowerCase();
    // Check if tool name appears in the output
    if (lowerOutput.includes(toolName)) {
      calledTools.push(tool);
    }
  }

  return calledTools;
}

/**
 * Validate with real Claude Code CLI by running the actual prompt
 * and detecting which tools Claude would call.
 */
async function validateWithClaudeCli(
  tests: E2ETestCase[],
  searchService: UnifiedSearchService,
  tools: ToolDefinition[]
): Promise<{ tested: number; passed: number; accuracy: number } | undefined> {
  try {
    spawnSync("claude", ["--version"], { encoding: "utf-8" });
  } catch {
    console.log(
      `\n${colors.yellow}⚠ Claude CLI not found, skipping E2E validation${colors.reset}`
    );
    return undefined;
  }

  console.log(
    `\n${colors.cyan}Running Claude CLI E2E validation...${colors.reset}`
  );

  let passed = 0;
  let tested = 0;
  const testSubset = tests.slice(0, 3);

  for (const test of testSubset) {
    tested++;

    // First, use our search to get relevant tools
    const response = await searchService.search({
      query: test.userPrompt,
      topK: 5,
    });

    const searchedTools = response.results.map((r) => r.name);
    const relevantToolDefs = tools.filter((t) =>
      searchedTools.includes(t.name)
    );

    const toolsDescription = relevantToolDefs
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    // Create a prompt that simulates what Claude would actually do
    const prompt = `Task: "${test.userPrompt}"

You have access to these tools:
${toolsDescription}

Think about which tool you would use for this task. Then output ONLY the tool name you would call, nothing else.`;

    try {
      const result = spawnSync("claude", ["-p", prompt], {
        encoding: "utf-8",
        timeout: 30_000,
      });

      const output = (result.stdout || "").trim();
      const calledTools = detectToolCallsFromOutput(output, test.expectedTools);

      // Check if any expected tool was called
      const hasExpectedTool = test.expectedTools.some((expected) =>
        calledTools.includes(expected)
      );

      if (hasExpectedTool) {
        passed++;
        console.log(
          `  ${colors.green}✓${colors.reset} ${test.id} - Called: ${calledTools.join(", ") || "none"}`
        );
      } else {
        console.log(
          `  ${colors.red}✗${colors.reset} ${test.id} - Expected: ${test.expectedTools.join(", ")}, Got: ${calledTools.join(", ") || "none"}`
        );
      }
    } catch (error) {
      console.log(
        `  ${colors.yellow}⚠${colors.reset} ${test.id} - Error: ${error}`
      );
    }
  }

  return {
    tested,
    passed,
    accuracy: tested > 0 ? (passed / tested) * 100 : 0,
  };
}

/**
 * Print benchmark summary.
 */
function printSummary(
  methods: MethodResult[],
  tokensSaved: number,
  percentSaved: number,
  canReplace: boolean,
  confidenceLevel: string,
  confidenceReason: string,
  claudeValidation?: { tested: number; passed: number; accuracy: number }
): void {
  const sortedMethods = [...methods].sort((a, b) => {
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    if (a.avgRank !== b.avgRank) return a.avgRank - b.avgRank;
    return a.avgSearchTimeMs - b.avgSearchTimeMs;
  });

  const bestMethod = sortedMethods[0];

  console.log(`\n${colors.bright}${"═".repeat(70)}${colors.reset}`);
  console.log(
    `${colors.bright}${colors.cyan}  BENCHMARK RESULTS${colors.reset}`
  );
  console.log(`${colors.bright}${"═".repeat(70)}${colors.reset}\n`);

  // Method comparison table
  console.log(`${colors.bright}  Method Comparison:${colors.reset}\n`);
  console.log(
    `  ${"Method".padEnd(20)} ${"Accuracy".padEnd(12)} ${"Avg Rank".padEnd(12)} ${"Avg Time".padEnd(12)}`
  );
  console.log(`  ${"-".repeat(56)}`);

  for (const m of sortedMethods) {
    const isBest = m.method === bestMethod?.method;
    const prefix = isBest ? `${colors.green}→${colors.reset}` : " ";
    const methodName = m.model ? `${m.method} (${m.model})` : m.method;
    const acc = `${m.accuracy.toFixed(1)}%`;
    const rank = m.avgRank.toFixed(2);
    const time = `${m.avgSearchTimeMs.toFixed(0)}ms`;

    console.log(
      `  ${prefix} ${methodName.padEnd(19)} ${acc.padEnd(12)} ${rank.padEnd(12)} ${time.padEnd(12)}`
    );
  }

  // Best method
  console.log(
    `\n${colors.bright}  Best Method: ${colors.green}${bestMethod?.method}${bestMethod?.model ? ` (${bestMethod.model})` : ""}${colors.reset}`
  );

  // Confidence
  const confidenceColor =
    confidenceLevel === "high"
      ? colors.green
      : confidenceLevel === "medium"
        ? colors.yellow
        : colors.red;

  console.log(
    `\n${colors.bright}  Can Replace Traditional Method?${colors.reset}`
  );
  if (canReplace) {
    console.log(
      `  ${colors.green}${colors.bright}✓ YES${colors.reset} - ${confidenceColor}${confidenceLevel.toUpperCase()} CONFIDENCE${colors.reset}`
    );
  } else {
    console.log(
      `  ${colors.red}${colors.bright}✗ NOT YET${colors.reset} - ${confidenceColor}${confidenceLevel.toUpperCase()} CONFIDENCE${colors.reset}`
    );
  }
  console.log(`  ${colors.dim}${confidenceReason}${colors.reset}`);

  // Token savings
  console.log(`\n${colors.bright}  Token Savings:${colors.reset}`);
  console.log(
    `  ${colors.green}Saved: ${percentSaved.toFixed(1)}% (~${tokensSaved.toLocaleString()} tokens/query)${colors.reset}`
  );

  // Claude validation
  if (claudeValidation) {
    console.log(
      `\n${colors.bright}  Claude CLI E2E Validation:${colors.reset}`
    );
    console.log(
      `  ${claudeValidation.passed}/${claudeValidation.tested} tests passed (${claudeValidation.accuracy.toFixed(1)}%)`
    );
  }

  // Final verdict
  console.log(`\n${colors.bright}${"═".repeat(70)}${colors.reset}`);
  const passed = bestMethod?.passed || 0;
  const total = bestMethod?.total || 0;

  if (passed === total && total > 0) {
    console.log(
      `${colors.bgGreen}${colors.bright}  ALL TESTS PASSED (${passed}/${total})  ${colors.reset}`
    );
  } else {
    console.log(
      `${colors.bgRed}${colors.bright}  ${passed}/${total} TESTS PASSED  ${colors.reset}`
    );
  }
  console.log(`${colors.bright}${"═".repeat(70)}${colors.reset}\n`);
}

/**
 * Run quick benchmark (default mode).
 */
async function runQuickBenchmark(args: CliArgs): Promise<void> {
  console.log(
    `\n${colors.bright}${colors.cyan}Tool Search MCP - Quick Benchmark${colors.reset}`
  );
  console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}\n`);

  // Load MCP tools
  console.log(`${colors.cyan}Loading MCP tools...${colors.reset}`);
  const mcpConfig = await loadMcpConfig();

  if (!mcpConfig) {
    console.error(
      `${colors.red}No MCP config found. Check ~/.claude.json${colors.reset}`
    );
    process.exit(1);
  }

  const allTools: ToolDefinition[] = [];
  const mcpServersFound: string[] = [];

  for (const [serverName, serverConfig] of Object.entries(
    mcpConfig.mcpServers
  )) {
    try {
      const serverTools = await getToolsFromMcpServer(serverName, serverConfig);
      allTools.push(...serverTools);
      mcpServersFound.push(serverName);
    } catch (error) {
      console.log(`  ${colors.yellow}⚠ ${serverName}: ${error}${colors.reset}`);
    }
  }

  console.log(
    `  ${colors.green}Loaded ${allTools.length} tools from ${mcpServersFound.length} servers${colors.reset}\n`
  );

  // Load tests
  const tests = args.extended
    ? await loadAllTests(mcpServersFound)
    : await loadPrimaryTests(mcpServersFound);

  if (tests.length === 0) {
    console.error(
      `${colors.red}No tests available for the loaded MCP servers${colors.reset}`
    );
    process.exit(1);
  }

  console.log(
    `${colors.cyan}Running ${tests.length} tests across ${mcpServersFound.length} MCP servers...${colors.reset}\n`
  );

  // Run benchmarks
  const methods: MethodResult[] = [];

  // 1. Embedding
  console.log(
    `${colors.magenta}Testing: embedding (${DEFAULT_EMBEDDING_MODEL})${colors.reset}`
  );
  try {
    const result = await benchmarkMethod(
      tests,
      allTools,
      "embedding",
      DEFAULT_EMBEDDING_MODEL,
      args.verbose
    );
    methods.push(result);
    console.log(
      `  ${colors.green}${result.passed}/${result.total} passed${colors.reset} (${result.accuracy.toFixed(1)}%)\n`
    );
  } catch (error) {
    console.log(`  ${colors.red}Error: ${error}${colors.reset}\n`);
  }

  // 2. BM25
  console.log(`${colors.magenta}Testing: BM25${colors.reset}`);
  const bm25Result = await benchmarkMethod(
    tests,
    allTools,
    "bm25",
    undefined,
    args.verbose
  );
  methods.push(bm25Result);
  console.log(
    `  ${colors.green}${bm25Result.passed}/${bm25Result.total} passed${colors.reset} (${bm25Result.accuracy.toFixed(1)}%)\n`
  );

  // 3. Regex
  console.log(`${colors.magenta}Testing: Regex${colors.reset}`);
  const regexResult = await benchmarkMethod(
    tests,
    allTools,
    "regex",
    undefined,
    args.verbose
  );
  methods.push(regexResult);
  console.log(
    `  ${colors.green}${regexResult.passed}/${regexResult.total} passed${colors.reset} (${regexResult.accuracy.toFixed(1)}%)\n`
  );

  // Calculate confidence
  const bestMethod = [...methods].sort((a, b) => b.accuracy - a.accuracy)[0];
  const bestAccuracy = bestMethod?.accuracy || 0;

  // Token estimates
  const tokensPerTool = 100;
  const traditionalTokens = allTools.length * tokensPerTool;
  const searchTokens = 3 * tokensPerTool + 50;
  const tokensSaved = traditionalTokens - searchTokens;
  const percentSaved =
    traditionalTokens > 0 ? (tokensSaved / traditionalTokens) * 100 : 0;

  let canReplace = false;
  let confidenceLevel: "high" | "medium" | "low" = "low";
  let confidenceReason = "";

  if (bestAccuracy === 100) {
    canReplace = true;
    confidenceLevel = "high";
    confidenceReason = "All tests passed - 100% accuracy with token savings";
  } else if (bestAccuracy >= 90) {
    canReplace = true;
    confidenceLevel = "medium";
    confidenceReason = `${bestAccuracy.toFixed(0)}% accuracy - good but not perfect`;
  } else if (bestAccuracy >= 80) {
    canReplace = false;
    confidenceLevel = "medium";
    confidenceReason = `${bestAccuracy.toFixed(0)}% accuracy - needs improvement`;
  } else {
    canReplace = false;
    confidenceLevel = "low";
    confidenceReason = `${bestAccuracy.toFixed(0)}% accuracy - significant improvements needed`;
  }

  // Claude validation
  let claudeValidation:
    | { tested: number; passed: number; accuracy: number }
    | undefined;
  if (args.claudeValidation && bestMethod) {
    const searchService = new UnifiedSearchService();
    if (bestMethod.method === "embedding") {
      searchService.registerEngine(
        createEmbeddingEngine(bestMethod.model, "rich")
      );
    } else if (bestMethod.method === "bm25") {
      searchService.registerEngine(createBM25Engine());
    } else {
      searchService.registerEngine(createRegexEngine());
    }
    await searchService.initializeEngine(bestMethod.method, allTools);
    searchService.setDefaultMethod(bestMethod.method);
    claudeValidation = await validateWithClaudeCli(
      tests,
      searchService,
      allTools
    );
  }

  // Print summary
  printSummary(
    methods,
    tokensSaved,
    percentSaved,
    canReplace,
    confidenceLevel,
    confidenceReason,
    claudeValidation
  );
}

/**
 * Run full comprehensive benchmark.
 */
async function runFullBenchmark(args: CliArgs): Promise<void> {
  console.log(
    `\n${colors.bright}${colors.cyan}Tool Search MCP - Full Benchmark${colors.reset}`
  );
  console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}\n`);

  // Import full benchmark modules
  const { runModelBenchmark, printBenchmarkReport, QUICK_TEST_CASES } =
    await import("./model-benchmark.js");

  // Load MCP tools
  console.log(`${colors.cyan}Loading MCP tools...${colors.reset}`);
  const mcpConfig = await loadMcpConfig();

  if (!mcpConfig) {
    console.error(
      `${colors.red}No MCP config found. Check ~/.claude.json${colors.reset}`
    );
    process.exit(1);
  }

  const allTools: ToolDefinition[] = [];
  const mcpServersFound: string[] = [];

  for (const [serverName, serverConfig] of Object.entries(
    mcpConfig.mcpServers
  )) {
    try {
      const serverTools = await getToolsFromMcpServer(serverName, serverConfig);
      allTools.push(...serverTools);
      mcpServersFound.push(serverName);
    } catch (error) {
      console.log(`  ${colors.yellow}⚠ ${serverName}: ${error}${colors.reset}`);
    }
  }

  console.log(
    `  ${colors.green}Loaded ${allTools.length} tools from ${mcpServersFound.length} servers${colors.reset}\n`
  );

  // Run comprehensive benchmark
  const report = await runModelBenchmark({
    testCases: QUICK_TEST_CASES,
    tools: allTools,
    methods: ["embedding", "bm25", "regex"],
    formats: getAvailableFormats() as EmbeddingFormat[],
    pullMissingModels: true,
  });

  printBenchmarkReport(report);
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.full) {
    await runFullBenchmark(args);
  } else {
    await runQuickBenchmark(args);
  }
}

// Run if executed directly
main().catch(console.error);
