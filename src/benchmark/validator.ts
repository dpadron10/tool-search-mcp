/**
 * Tool Search MCP Benchmark - Validation Module
 *
 * Redesigned validation system that:
 * 1. Creates test sets for known MCPs (Playwright, Plane, etc.)
 * 2. Generates test sets on-the-fly for unknown MCPs using heuristics
 * 3. Scores tool selection with and without semantic search
 * 4. Measures actual task success rate
 */

import type { SearchResult, ToolDefinition } from "../search/index";

/**
 * A test case for validating tool selection.
 */
export interface TestCase {
  id: string;
  query: string;
  description: string;
  expectedTools: string[];
  expectedParams?: Record<string, unknown>;
  validateResult?: (result: unknown) => boolean;
}

/**
 * A test set for a specific MCP.
 */
export interface McpTestSet {
  pattern: RegExp;
  testCases: TestCase[];
}

/**
 * Result of running a single test.
 */
export interface TestResult {
  testId: string;
  query: string;
  passed: boolean;
  duration: number;
  toolsSelected: string[];
  expectedTools: string[];
  missingTools: string[];
  unexpectedTools: string[];
  toolMatchScore: number;
  tokensUsed: number;
  result?: unknown;
  error?: string;
}

/**
 * Comparison result between baseline and search modes.
 */
export interface ComparisonResult {
  testId: string;
  query: string;
  baseline: {
    toolsSelected: string[];
    passed: boolean;
    tokensUsed: number;
    matchScore: number;
  };
  withSearch: {
    toolsSelected: string[];
    passed: boolean;
    tokensUsed: number;
    matchScore: number;
  };
  improvement: {
    tokensSaved: number;
    tokenReduction: number;
    accuracyChange: number;
    successImproved: boolean;
  };
}

/**
 * Aggregated benchmark report.
 */
export interface BenchmarkReport {
  mcpIdentified: string[];
  totalTests: number;
  baselineMode: {
    passed: number;
    failed: number;
    passRate: number;
    avgTokens: number;
    avgMatchScore: number;
  };
  searchMode: {
    passed: number;
    failed: number;
    passRate: number;
    avgTokens: number;
    avgMatchScore: number;
  };
  comparison: {
    avgTokensSaved: number;
    avgTokenReduction: number;
    successRateChange: number;
    summary: "significant" | "moderate" | "minimal" | "negative";
  };
  results: ComparisonResult[];
  recommendations: string[];
}

// Pre-defined patterns for known MCPs (moved to module level for performance)
const PLAYWRIGHT_PATTERN = /playwright|mcp-playwright/i;
const PLANE_PATTERN = /plane|project-management/i;
const CONTEXT7_PATTERN = /context7|docs/i;
const MARKDOWN_PATTERN = /markitdown|markdown/i;
const MINIMAX_PATTERN = /minimax|ai/i;

// Regex to extract server prefix from tool name (e.g., "playwright_browser_navigate" -> "playwright")
const SERVER_PREFIX_REGEX = /^([^_]+)_/;

/**
 * Test sets for known MCPs.
 */
export const KNOWN_MCP_TEST_SETS: McpTestSet[] = [
  {
    pattern: PLAYWRIGHT_PATTERN,
    testCases: [
      {
        id: "pw-navigate",
        query: "navigate to https://example.com",
        description: "Navigate to a URL",
        expectedTools: ["playwright_browser_navigate"],
      },
      {
        id: "pw-click",
        query: "click the submit button with locator 'button.submit'",
        description: "Click an element by locator",
        expectedTools: ["playwright_browser_click"],
      },
      {
        id: "pw-type",
        query: "type 'hello world' into the email input field",
        description: "Type text into an input",
        expectedTools: ["playwright_browser_type"],
      },
      {
        id: "pw-screenshot",
        query: "take a screenshot of the page",
        description: "Take a screenshot",
        expectedTools: ["playwright_browser_take_screenshot"],
      },
      {
        id: "pw-evaluate",
        query: "run JavaScript to get the page title",
        description: "Execute JavaScript in browser",
        expectedTools: ["playwright_browser_evaluate"],
      },
      {
        id: "pw-file-upload",
        query: "upload a file from /path/to/file.txt",
        description: "Upload a file",
        expectedTools: ["playwright_browser_file_upload"],
      },
      {
        id: "pw-console",
        query: "get all console messages from the page",
        description: "Read console logs",
        expectedTools: ["playwright_browser_console_messages"],
      },
      {
        id: "pw-network",
        query: "list all network requests made by the page",
        description: "Monitor network requests",
        expectedTools: ["playwright_browser_network_requests"],
      },
    ],
  },
  {
    pattern: PLANE_PATTERN,
    testCases: [
      {
        id: "plane-list-projects",
        query: "list all projects in the workspace",
        description: "List projects",
        expectedTools: ["plane_list_projects"],
      },
      {
        id: "plane-get-project",
        query: "get details of project with ID 'abc123'",
        description: "Get project details",
        expectedTools: ["plane_retrieve_project"],
      },
      {
        id: "plane-create-issue",
        query:
          "create a new issue in project 'my-project' with title 'Bug fix needed'",
        description: "Create work item",
        expectedTools: ["plane_create_work_item"],
      },
      {
        id: "plane-list-issues",
        query: "list all issues in project 'my-project'",
        description: "List work items",
        expectedTools: ["plane_list_work_items"],
      },
      {
        id: "plane-update-state",
        query: "move issue 'ABC-123' to the 'Done' state",
        description: "Update work item state",
        expectedTools: ["plane_update_work_item"],
      },
      {
        id: "plane-create-cycle",
        query: "create a new sprint/cycle named 'Sprint 24' starting today",
        description: "Create cycle",
        expectedTools: ["plane_create_cycle"],
      },
    ],
  },
  {
    pattern: CONTEXT7_PATTERN,
    testCases: [
      {
        id: "c7-resolve-library",
        query: "what library ID should I use for React documentation",
        description: "Resolve library ID",
        expectedTools: ["context7_resolve-library-id"],
      },
      {
        id: "c7-query-docs",
        query: "how do I use useState hook in React",
        description: "Query documentation",
        expectedTools: ["context7_query-docs"],
      },
    ],
  },
  {
    pattern: MARKDOWN_PATTERN,
    testCases: [
      {
        id: "md-convert",
        query: "convert /path/to/document.pdf to markdown",
        description: "Convert file to markdown",
        expectedTools: ["markitdown_convert_to_markdown"],
      },
    ],
  },
  {
    pattern: MINIMAX_PATTERN,
    testCases: [
      {
        id: "mm-web-search",
        query: "search the web for latest TypeScript news",
        description: "Web search",
        expectedTools: ["MiniMax_web_search"],
      },
      {
        id: "mm-understand-image",
        query: "describe what's in the image at /path/to/image.png",
        description: "Understand image",
        expectedTools: ["MiniMax_understand_image"],
      },
    ],
  },
];

/**
 * Find matching test sets for the loaded tools.
 */
export function identifyMcpTestSets(tools: ToolDefinition[]): McpTestSet[] {
  const serverNames = new Set<string>();

  for (const tool of tools) {
    const match = tool.name.match(SERVER_PREFIX_REGEX);
    if (match) {
      serverNames.add(match[1]);
    }
  }

  const matchedSets: McpTestSet[] = [];

  for (const testSet of KNOWN_MCP_TEST_SETS) {
    for (const serverName of serverNames) {
      if (testSet.pattern.test(serverName)) {
        matchedSets.push(testSet);
        break;
      }
    }
  }

  return matchedSets;
}

/**
 * Generate test cases for unknown MCPs using heuristic-based approach.
 */
export function generateTestCasesForUnknownMcp(
  tools: ToolDefinition[]
): TestCase[] {
  const testCases: TestCase[] = [];
  const serverTools = new Map<string, ToolDefinition[]>();

  for (const tool of tools) {
    const match = tool.name.match(SERVER_PREFIX_REGEX);
    if (match) {
      const serverName = match[1];
      if (!serverTools.has(serverName)) {
        serverTools.set(serverName, []);
      }
      const list = serverTools.get(serverName);
      if (list) {
        list.push(tool);
      }
    }
  }

  for (const [serverName, serverToolsList] of serverTools) {
    const hasKnownSet = KNOWN_MCP_TEST_SETS.some((set) =>
      set.pattern.test(serverName)
    );
    if (hasKnownSet) {
      continue;
    }

    for (const tool of serverToolsList.slice(0, 10)) {
      const testCase = createTestCaseFromTool(serverName, tool);
      if (testCase) {
        testCases.push(testCase);
      }
    }
  }

  return testCases;
}

/**
 * Create a test case from a tool definition.
 */
function createTestCaseFromTool(
  serverName: string,
  tool: ToolDefinition
): TestCase | null {
  if (!tool.description || tool.description.length < 10) {
    return null;
  }

  const name = tool.name.replace(`${serverName}_`, "");
  const query = inferQueryFromTool(name, tool.description.toLowerCase());

  return {
    id: `${serverName}-${name}`,
    query,
    description: `Test ${serverName} tool: ${name}`,
    expectedTools: [tool.name],
  };
}

/**
 * Infer a natural language query from a tool's name and description.
 */
function inferQueryFromTool(name: string, description: string): string {
  const normalizedName = name.replace(/_/g, " ");

  if (
    description.includes("get") ||
    description.includes("list") ||
    description.includes("retrieve")
  ) {
    return normalizedName;
  }
  if (description.includes("create") || description.includes("add")) {
    return `create a new ${normalizedName.replace("create ", "")}`;
  }
  if (
    description.includes("update") ||
    description.includes("modify") ||
    description.includes("edit")
  ) {
    return `update the ${normalizedName.replace("update ", "").replace("edit ", "")}`;
  }
  if (description.includes("delete") || description.includes("remove")) {
    return `delete the ${normalizedName.replace("delete ", "").replace("remove ", "")}`;
  }

  return normalizedName;
}

/**
 * Run tests in baseline mode (all tools loaded, no search filtering).
 * This simulates the real-world scenario where ALL tools are sent to Claude.
 */
export async function runBaselineTests(
  tools: ToolDefinition[],
  testCases: TestCase[]
): Promise<TestResult[]> {
  // Await to ensure async function behavior (silences biome warning)
  await Promise.resolve();

  const results: TestResult[] = [];

  // Calculate total tokens for ALL tools (baseline scenario)
  const allToolsTokens = tools.reduce(
    (sum, tool) =>
      sum + tool.description.length + JSON.stringify(tool.input_schema).length,
    0
  );

  for (const testCase of testCases) {
    const startTime = Date.now();

    try {
      // In baseline mode, ALL tools are loaded (not filtered)
      // Check if expected tools exist in the full tool set
      const expectedToolsExist = testCase.expectedTools.every((expected) =>
        tools.some((tool) => tool.name === expected)
      );

      const missing = testCase.expectedTools.filter(
        (e) => !tools.some((t) => t.name === e)
      );

      results.push({
        testId: testCase.id,
        query: testCase.query,
        passed: expectedToolsExist,
        duration: Date.now() - startTime,
        toolsSelected: tools.map((t) => t.name), // All tools are "selected" in baseline
        expectedTools: testCase.expectedTools,
        missingTools: missing,
        unexpectedTools: [], // In baseline, having all tools is expected
        toolMatchScore: expectedToolsExist ? 100 : 0,
        tokensUsed: allToolsTokens, // Full token cost of ALL tools
      });
    } catch {
      results.push({
        testId: testCase.id,
        query: testCase.query,
        passed: false,
        duration: Date.now() - startTime,
        toolsSelected: [],
        expectedTools: testCase.expectedTools,
        missingTools: testCase.expectedTools,
        unexpectedTools: [],
        toolMatchScore: 0,
        tokensUsed: 0,
      });
    }
  }

  return results;
}

/**
 * Run tests in search mode (semantic search filters tools first).
 */
export async function runSearchTests(
  tools: ToolDefinition[],
  testCases: TestCase[],
  searchFn: (query: string) => Promise<SearchResult[]>,
  topK = 3 // Match the main benchmark's topK for consistency
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const testCase of testCases) {
    const startTime = Date.now();

    try {
      const searchResults = await searchFn(testCase.query);
      const searchToolNames = searchResults.slice(0, topK).map((r) => r.name);
      const selectedTools = tools.filter((tool) =>
        searchToolNames.includes(tool.name)
      );

      const result = evaluateTestResult(testCase, selectedTools);
      results.push({ ...result, duration: Date.now() - startTime });
    } catch {
      results.push({
        testId: testCase.id,
        query: testCase.query,
        passed: false,
        duration: Date.now() - startTime,
        toolsSelected: [],
        expectedTools: testCase.expectedTools,
        missingTools: testCase.expectedTools,
        unexpectedTools: [],
        toolMatchScore: 0,
        tokensUsed: 0,
      });
    }
  }

  return results;
}

/**
 * Evaluate if a test passed based on selected tools.
 */
function evaluateTestResult(
  testCase: TestCase,
  selectedTools: ToolDefinition[]
): Omit<TestResult, "duration"> {
  const selectedNames = selectedTools.map((t) => t.name);
  const expectedSet = new Set(testCase.expectedTools);
  const selectedSet = new Set(selectedNames);

  const missing = testCase.expectedTools.filter((e) => !selectedSet.has(e));
  const unexpected = selectedNames.filter((s) => !expectedSet.has(s));
  const matched = testCase.expectedTools.filter((e) => selectedSet.has(e));

  const tokensUsed = selectedTools.reduce(
    (sum, tool) =>
      sum + tool.description.length + JSON.stringify(tool.input_schema).length,
    0
  );

  const matchScore =
    testCase.expectedTools.length > 0
      ? (matched.length / testCase.expectedTools.length) * 100
      : 100;

  // Pass if all expected tools are found (missing=0)
  // Allow unexpected tools since search returns topK results regardless of expected count
  const passed = missing.length === 0;

  return {
    testId: testCase.id,
    query: testCase.query,
    passed,
    toolsSelected: selectedNames,
    expectedTools: testCase.expectedTools,
    missingTools: missing,
    unexpectedTools: unexpected,
    toolMatchScore: Number(matchScore.toFixed(2)),
    tokensUsed,
  };
}

/**
 * Compare baseline and search mode results.
 */
export function compareResults(
  testCases: TestCase[],
  baselineResults: TestResult[],
  searchResults: TestResult[]
): ComparisonResult[] {
  const comparisons: ComparisonResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const baseline = baselineResults[i];
    const search = searchResults[i];

    if (!(baseline && search)) {
      continue;
    }

    const tokensSaved = baseline.tokensUsed - search.tokensUsed;
    const tokenReduction =
      baseline.tokensUsed > 0 ? (tokensSaved / baseline.tokensUsed) * 100 : 0;
    const accuracyChange = search.toolMatchScore - baseline.toolMatchScore;
    const successImproved = search.passed && !baseline.passed;

    comparisons.push({
      testId: testCase.id,
      query: testCase.query,
      baseline: {
        toolsSelected: baseline.toolsSelected,
        passed: baseline.passed,
        tokensUsed: baseline.tokensUsed,
        matchScore: baseline.toolMatchScore,
      },
      withSearch: {
        toolsSelected: search.toolsSelected,
        passed: search.passed,
        tokensUsed: search.tokensUsed,
        matchScore: search.toolMatchScore,
      },
      improvement: {
        tokensSaved,
        tokenReduction: Number(tokenReduction.toFixed(2)),
        accuracyChange: Number(accuracyChange.toFixed(2)),
        successImproved,
      },
    });
  }

  return comparisons;
}

/**
 * Generate recommendations based on benchmark results.
 */
function generateRecommendations(
  comparisons: ComparisonResult[],
  baselinePassRate: number,
  searchPassRate: number
): string[] {
  const recommendations: string[] = [];

  const avgTokenReduction =
    comparisons.reduce((sum, c) => sum + c.improvement.tokenReduction, 0) /
    comparisons.length;

  if (avgTokenReduction > 80) {
    recommendations.push(
      `✅ SIGNIFICANT SAVINGS: Tool search reduces token usage by ${avgTokenReduction.toFixed(1)}% on average.`
    );
  } else if (avgTokenReduction > 50) {
    recommendations.push(
      `📊 MODERATE SAVINGS: Tool search reduces token usage by ${avgTokenReduction.toFixed(1)}% on average.`
    );
  } else if (avgTokenReduction > 20) {
    recommendations.push(
      `⚠️ MINIMAL SAVINGS: Tool search only reduces token usage by ${avgTokenReduction.toFixed(1)}%.`
    );
  } else {
    recommendations.push(
      "❌ NEGLIGIBLE IMPACT: Tool search provides minimal token savings."
    );
  }

  const successChange = searchPassRate - baselinePassRate;
  if (successChange > 20) {
    recommendations.push(
      `🎯 ACCURACY BOOST: Search mode improves task success rate by ${successChange.toFixed(1)}%.`
    );
  } else if (successChange > 0) {
    recommendations.push(
      `📈 SLIGHT IMPROVEMENT: Search mode improves success rate by ${successChange.toFixed(1)}%.`
    );
  } else if (successChange < -20) {
    recommendations.push(
      `⚠️ ACCURACY DROP: Search mode reduces success rate by ${Math.abs(successChange).toFixed(1)}%. Consider tuning the search threshold.`
    );
  }

  return recommendations;
}

/**
 * Generate a comprehensive benchmark report.
 */
export async function generateBenchmarkReport(
  tools: ToolDefinition[],
  searchFn: (query: string) => Promise<SearchResult[]>
): Promise<BenchmarkReport> {
  const matchedTestSets = identifyMcpTestSets(tools);
  const knownTestCases = matchedTestSets.flatMap((set) => set.testCases);
  const unknownTestCases = generateTestCasesForUnknownMcp(tools);
  const allTestCases = [...knownTestCases, ...unknownTestCases];

  if (allTestCases.length === 0) {
    return {
      mcpIdentified: [],
      totalTests: 0,
      baselineMode: {
        passed: 0,
        failed: 0,
        passRate: 0,
        avgTokens: 0,
        avgMatchScore: 0,
      },
      searchMode: {
        passed: 0,
        failed: 0,
        passRate: 0,
        avgTokens: 0,
        avgMatchScore: 0,
      },
      comparison: {
        avgTokensSaved: 0,
        avgTokenReduction: 0,
        successRateChange: 0,
        summary: "minimal",
      },
      results: [],
      recommendations: [
        "No test cases generated. Ensure MCP tools have descriptions.",
      ],
    };
  }

  const baselineResults = await runBaselineTests(tools, allTestCases);
  const searchResults = await runSearchTests(tools, allTestCases, searchFn);
  const comparisons = compareResults(
    allTestCases,
    baselineResults,
    searchResults
  );

  const baselinePassed = baselineResults.filter((r) => r.passed).length;
  const searchPassed = searchResults.filter((r) => r.passed).length;
  const baselineAvgTokens =
    baselineResults.reduce((sum, r) => sum + r.tokensUsed, 0) /
    baselineResults.length;
  const searchAvgTokens =
    searchResults.reduce((sum, r) => sum + r.tokensUsed, 0) /
    searchResults.length;
  const baselineAvgScore =
    baselineResults.reduce((sum, r) => sum + r.toolMatchScore, 0) /
    baselineResults.length;
  const searchAvgScore =
    searchResults.reduce((sum, r) => sum + r.toolMatchScore, 0) /
    searchResults.length;

  const baselinePassRate = (baselinePassed / baselineResults.length) * 100;
  const searchPassRate = (searchPassed / searchResults.length) * 100;
  const avgTokenReduction =
    baselineAvgTokens > 0
      ? ((baselineAvgTokens - searchAvgTokens) / baselineAvgTokens) * 100
      : 0;

  let summary: "significant" | "moderate" | "minimal" | "negative";
  if (avgTokenReduction > 80 && searchPassRate >= baselinePassRate) {
    summary = "significant";
  } else if (
    avgTokenReduction > 50 &&
    searchPassRate >= baselinePassRate - 10
  ) {
    summary = "moderate";
  } else if (avgTokenReduction > 20) {
    summary = "minimal";
  } else {
    summary = "negative";
  }

  const recommendations = generateRecommendations(
    comparisons,
    baselinePassRate,
    searchPassRate
  );

  return {
    mcpIdentified: matchedTestSets.map((s) =>
      s.pattern.source.replace(/\\\W/g, "")
    ),
    totalTests: allTestCases.length,
    baselineMode: {
      passed: baselinePassed,
      failed: baselineResults.length - baselinePassed,
      passRate: Number(baselinePassRate.toFixed(2)),
      avgTokens: Math.round(baselineAvgTokens),
      avgMatchScore: Number(baselineAvgScore.toFixed(2)),
    },
    searchMode: {
      passed: searchPassed,
      failed: searchResults.length - searchPassed,
      passRate: Number(searchPassRate.toFixed(2)),
      avgTokens: Math.round(searchAvgTokens),
      avgMatchScore: Number(searchAvgScore.toFixed(2)),
    },
    comparison: {
      avgTokensSaved: Math.round(baselineAvgTokens - searchAvgTokens),
      avgTokenReduction: Number(avgTokenReduction.toFixed(2)),
      successRateChange: Number((searchPassRate - baselinePassRate).toFixed(2)),
      summary,
    },
    results: comparisons,
    recommendations,
  };
}

/**
 * Format benchmark report for display.
 */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push(`\n${"=".repeat(70)}`);
  lines.push("BENCHMARK REPORT");
  lines.push(`${"=".repeat(70)}`);

  if (report.mcpIdentified.length > 0) {
    lines.push(`\n📦 Identified MCPs: ${report.mcpIdentified.join(", ")}`);
  } else {
    lines.push("\n📦 No known MCPs identified. Using generated test cases.");
  }
  lines.push(`   Total Tests: ${report.totalTests}`);

  lines.push(`\n${"-".repeat(70)}`);
  lines.push("BASELINE MODE (All Tools Loaded - No Search Filtering)");
  lines.push("-".repeat(70));
  lines.push(`   Pass Rate: ${report.baselineMode.passRate.toFixed(1)}%`);
  lines.push(`   Avg Tokens/Query: ${report.baselineMode.avgTokens}`);
  lines.push(
    `   Avg Match Score: ${report.baselineMode.avgMatchScore.toFixed(1)}%`
  );

  lines.push(`\n${"-".repeat(70)}`);
  lines.push("SEARCH MODE (Semantic Search Filters Tools)");
  lines.push("-".repeat(70));
  lines.push(`   Pass Rate: ${report.searchMode.passRate.toFixed(1)}%`);
  lines.push(`   Avg Tokens/Query: ${report.searchMode.avgTokens}`);
  lines.push(
    `   Avg Match Score: ${report.searchMode.avgMatchScore.toFixed(1)}%`
  );

  lines.push(`\n${"=".repeat(70)}`);
  lines.push("COMPARISON");
  lines.push("=".repeat(70));
  lines.push(`\n   Tokens Saved/Query: ${report.comparison.avgTokensSaved}`);
  lines.push(
    `   Token Reduction: ${report.comparison.avgTokenReduction.toFixed(1)}%`
  );
  lines.push(
    `   Success Rate Change: ${report.comparison.successRateChange >= 0 ? "+" : ""}${report.comparison.successRateChange.toFixed(1)}%`
  );

  const summaryEmoji = {
    significant: "✅",
    moderate: "📊",
    minimal: "⚠️",
    negative: "❌",
  }[report.comparison.summary];

  lines.push(
    `\n   ${summaryEmoji} Summary: ${report.comparison.summary.toUpperCase()}`
  );

  lines.push(`\n${"=".repeat(70)}`);
  lines.push("RECOMMENDATIONS");
  lines.push(`${"=".repeat(70)}\n`);

  for (const rec of report.recommendations) {
    lines.push(`   ${rec}`);
  }

  lines.push(`\n${"=".repeat(70)}`);

  return lines.join("\n");
}

// Legacy exports for backward compatibility
export interface ValidationTestCase {
  id: string;
  query: string;
  description: string;
  expectedTools: Array<{
    toolName: string;
    parameters: Record<string, unknown>;
    priority: "required" | "optional" | "expected";
  }>;
}

export interface ValidationReport {
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  averageLatency: number;
  averageTokenSavings: number;
  toolSelectionAccuracy: number;
  results: Array<{
    testId: string;
    query: string;
    passed: boolean;
    duration: number;
    toolMatchScore: number;
    missingTools: string[];
    unexpectedTools: string[];
  }>;
  recommendations: string[];
}

export function createStandardTestCases(): ValidationTestCase[] {
  return [
    {
      id: "file-read",
      query: "read the contents of a file",
      description: "Test file reading",
      expectedTools: [],
    },
    {
      id: "file-write",
      query: "write content to a file",
      description: "Test file writing",
      expectedTools: [],
    },
    {
      id: "directory-listing",
      query: "list files in a directory",
      description: "Test listing",
      expectedTools: [],
    },
  ];
}

/**
 * Measures tool selection performance under load.
 */
export interface LoadTestResult {
  concurrentRequests: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
}

/**
 * Runs a load test on tool selection.
 */
export async function runLoadTest(
  toolSelector: (query: string) => Promise<{ tools: ToolDefinition[] }>,
  queries: string[],
  concurrentRequests = 10
): Promise<LoadTestResult> {
  const latencies: number[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;

  const runQuery = async (query: string): Promise<void> => {
    const startTime = Date.now();
    try {
      await toolSelector(query);
      const duration = Date.now() - startTime;
      latencies.push(duration);
      successfulRequests++;
    } catch {
      failedRequests++;
    }
  };

  const batches: string[][] = [];
  for (let i = 0; i < queries.length; i += concurrentRequests) {
    batches.push(queries.slice(i, i + concurrentRequests));
  }

  for (const batch of batches) {
    await Promise.all(batch.map((query) => runQuery(query)));
  }

  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const totalRequests = queries.length;
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
  const p95Index = Math.floor(sortedLatencies.length * 0.95);
  const p99Index = Math.floor(sortedLatencies.length * 0.99);
  const p95Latency = sortedLatencies[p95Index] ?? 0;
  const p99Latency = sortedLatencies[p99Index] ?? 0;
  const throughput = successfulRequests / (avgLatency / 1000);

  return {
    concurrentRequests,
    totalRequests,
    successfulRequests,
    failedRequests,
    averageLatency: Number(avgLatency.toFixed(2)),
    p95Latency: Number(p95Latency.toFixed(2)),
    p99Latency: Number(p99Latency.toFixed(2)),
    throughput: Number(throughput.toFixed(2)),
  };
}

/**
 * Formats load test results for display.
 */
export function formatLoadTestResult(result: LoadTestResult): string {
  const lines: string[] = [];

  lines.push(`\n${"=".repeat(70)}`);
  lines.push("LOAD TEST RESULTS");
  lines.push(`${"=".repeat(70)}`);

  lines.push(`\n📊 CONCURRENT REQUESTS: ${result.concurrentRequests}`);
  lines.push(`   Total Requests: ${result.totalRequests}`);
  lines.push(`   Successful: ${result.successfulRequests} ✅`);
  lines.push(`   Failed: ${result.failedRequests} ❌`);
  lines.push(
    `   Success Rate: ${((result.successfulRequests / result.totalRequests) * 100).toFixed(1)}%`
  );

  lines.push("\n⏱️ LATENCY (ms)");
  lines.push(`   Average: ${result.averageLatency.toFixed(2)}`);
  lines.push(`   P95: ${result.p95Latency.toFixed(2)}`);
  lines.push(`   P99: ${result.p99Latency.toFixed(2)}`);

  lines.push("\n🚀 THROUGHPUT");
  lines.push(`   ${result.throughput.toFixed(2)} requests/second`);

  lines.push(`\n${"=".repeat(70)}`);

  return lines.join("\n");
}
