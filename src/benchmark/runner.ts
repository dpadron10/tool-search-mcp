/**
 * Benchmark Runner Module
 *
 * Orchestrates the complete benchmark workflow:
 * 1. Load tools from MCP configuration
 * 2. Run token calculation comparisons
 * 3. Execute validation tests
 * 4. Generate comprehensive reports
 */

import type { SearchResult, ToolDefinition } from "../search/index";
import {
  analyzeToolTokens,
  CONTEXT_OVERHEAD,
  calculateScenarioTokens,
  type projectSavings,
  type SavingsMetrics,
  type ScenarioResult,
} from "./calculator";
import { countToolsTokens, estimateApiCost, formatTokens } from "./tokenizer";
import {
  type BenchmarkReport,
  formatBenchmarkReport,
  formatLoadTestResult,
  generateBenchmarkReport,
  type LoadTestResult,
  runLoadTest,
} from "./validator";

/**
 * Configuration for the benchmark runner.
 */
export interface BenchmarkConfig {
  model: string;
  testQueries?: string[];
  loadTestConfig: {
    concurrentRequests: number;
    iterations: number;
  };
  outputFormat: "text" | "json" | "both";
}

/**
 * Complete benchmark results.
 */
export interface BenchmarkResults {
  metadata: {
    timestamp: string;
    model: string;
    totalTools: number;
  };
  tokenComparison: {
    baseline: ScenarioResult;
    dynamic: ScenarioResult;
    savings: SavingsMetrics;
  };
  validation: BenchmarkReport | null;
  loadTest: LoadTestResult | null;
  toolAnalysis: {
    topConsumers: Array<{ name: string; tokens: number; percentage: number }>;
    totalTokens: number;
  };
  projections: {
    daily: Awaited<ReturnType<typeof projectSavings>>;
    weekly: Awaited<ReturnType<typeof projectSavings>>;
    monthly: Awaited<ReturnType<typeof projectSavings>>;
    annual: Awaited<ReturnType<typeof projectSavings>>;
  };
}

/**
 * Default benchmark configuration.
 */
const DEFAULT_CONFIG: BenchmarkConfig = {
  model: "claude-sonnet-4-20250514",
  testQueries: [], // Tests are now dynamically loaded from test files
  loadTestConfig: {
    concurrentRequests: 5,
    iterations: 20,
  },
  outputFormat: "text",
};

/**
 * Search service interface for the benchmark runner.
 */
interface BenchmarkSearchService {
  search: (params: {
    query: string;
    topK?: number;
  }) => Promise<{ results: SearchResult[] } | SearchResult[]>;
  reload?: (tools: ToolDefinition[]) => Promise<void>;
  initialize?: (tools: ToolDefinition[]) => Promise<void>;
}

export class BenchmarkRunner {
  private readonly config: BenchmarkConfig;
  private allTools: ToolDefinition[] = [];
  private readonly searchService: BenchmarkSearchService;

  constructor(
    searchService: BenchmarkSearchService,
    config?: Partial<BenchmarkConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.searchService = searchService;
  }

  /**
   * Helper to extract results from search response.
   */
  private extractResults(
    response: { results: SearchResult[] } | SearchResult[]
  ): SearchResult[] {
    if (Array.isArray(response)) {
      return response;
    }
    return response.results;
  }

  /**
   * Loads all tools from MCP configuration.
   */
  async loadTools(
    toolLoader: () => Promise<ToolDefinition[]>
  ): Promise<ToolDefinition[]> {
    console.log("\n📦 Loading tools from MCP configuration...");

    this.allTools = await toolLoader();

    if (this.allTools.length === 0) {
      throw new Error(
        "No tools found in MCP config. Please configure MCP servers with tools in Claude Code or Cursor."
      );
    }

    console.log(`   Loaded ${this.allTools.length} tools`);
    console.log(`   Tools: ${this.allTools.map((t) => t.name).join(", ")}`);

    // Initialize the embedding engine
    console.log("\n🔍 Initializing semantic search engine...");
    if (this.searchService.initialize) {
      await this.searchService.initialize(this.allTools);
    } else if (this.searchService.reload) {
      await this.searchService.reload(this.allTools);
    }
    console.log("   Search engine ready");

    return this.allTools;
  }

  /**
   * Load queries for token comparison benchmark.
   * Uses pre-prepared tests or generates on-the-fly for unknown MCPs.
   */
  private async loadQueriesForBenchmark(): Promise<string[]> {
    console.log("\n📋 Loading benchmark queries...");

    // Identify MCP servers from tool names
    const mcpServers = new Set<string>();
    for (const tool of this.allTools) {
      const prefix = tool.name.split("_")[0];
      if (prefix) {
        mcpServers.add(prefix);
      }
    }

    const { loadPrePreparedTests, generateDynamicTests } = await import(
      "./tests/index.js"
    );

    // Load pre-prepared tests
    const prePreparedTests = await loadPrePreparedTests(Array.from(mcpServers));
    console.log(
      `   Loaded ${prePreparedTests.length} pre-prepared test queries`
    );

    // Generate dynamic tests for servers without pre-prepared tests
    const dynamicTests: string[] = [];
    for (const serverName of mcpServers) {
      const serverTools = this.allTools.filter((t) =>
        t.name.startsWith(`${serverName}_`)
      );
      const hasTests = prePreparedTests.some((t) =>
        t.expectedTools.some((et) => et.startsWith(`${serverName}_`))
      );

      if (!hasTests && serverTools.length > 0) {
        const generatedTests = generateDynamicTests(serverName, serverTools);
        dynamicTests.push(...generatedTests.map((t) => t.query));
        console.log(
          `   Generated ${generatedTests.length} queries for ${serverName}`
        );
      }
    }

    // Combine queries from pre-prepared tests and dynamic tests
    const allQueries = [
      ...prePreparedTests.map((t) => t.query),
      ...dynamicTests,
    ];

    // Ensure we have at least 5 queries for meaningful benchmark
    if (allQueries.length < 5) {
      const fallbackQueries = [
        "navigate to a URL",
        "click a button",
        "take a screenshot",
        "type text",
        "close the browser",
      ];
      console.log(
        `   Using ${fallbackQueries.length - allQueries.length} fallback queries`
      );
      return [...allQueries, ...fallbackQueries].slice(0, 10);
    }

    return allQueries.slice(0, 10);
  }

  /**
   * Loads tests dynamically based on available MCP servers.
   * Uses pre-prepared tests if available, generates on-the-fly otherwise.
   */
  async loadTests(mcpServers: string[]): Promise<string[]> {
    console.log("\n📋 Loading test cases...");

    // Import dynamically to avoid circular dependencies
    // biome-ignore lint/style/useNodejsImportCopyJavaScriptResolution: file extension required for dynamic imports
    const { loadPrePreparedTests, generateDynamicTests } = await import(
      "./tests/index.js"
    );

    // Load pre-prepared tests
    const prePreparedTests = await loadPrePreparedTests(mcpServers);
    console.log(`   Loaded ${prePreparedTests.length} pre-prepared tests`);

    // Generate dynamic tests for unknown MCP servers
    const dynamicTests: string[] = [];
    for (const serverName of mcpServers) {
      // Check if we have tests for this server
      const serverTools = this.allTools.filter((t) =>
        t.name.startsWith(serverName.split("_")[0])
      );

      if (serverTools.length > 0) {
        // Generate tests for unknown servers
        const generatedTests = generateDynamicTests(serverName, serverTools);
        console.log(
          `   Generated ${generatedTests.length} tests for ${serverName}`
        );

        // Add queries from generated tests
        for (const test of generatedTests) {
          if (!dynamicTests.includes(test.query)) {
            dynamicTests.push(test.query);
          }
        }
      }
    }

    return dynamicTests;
  }

  /**
   * Runs token comparison between baseline (all tools) and dynamic (filtered tools).
   */
  async runTokenComparison(): Promise<{
    baseline: ScenarioResult;
    dynamic: ScenarioResult;
    savings: SavingsMetrics;
  }> {
    console.log(`\n${"=".repeat(70)}`);
    console.log("TOKEN USAGE COMPARISON");
    console.log("=".repeat(70));

    // Baseline scenario: All tools loaded
    console.log("\n📊 Scenario A: Standard (Load ALL Tools)");
    const baselineTokens = await calculateScenarioTokens(this.allTools, {
      model: this.config.model,
      includeOverhead: true,
    });

    const baseline: ScenarioResult = {
      name: "Baseline (All Tools)",
      description: "Standard approach: load all available tools",
      tools: this.allTools,
      tokens: baselineTokens,
      savings: null,
    };

    console.log(`   Tools: ${baselineTokens.toolCount}`);
    console.log(
      `   Character count: ${baselineTokens.charCount.toLocaleString()}`
    );
    console.log(
      `   Raw tool tokens: ${formatTokens(baselineTokens.rawToolTokens)}`
    );
    console.log(
      `   Overhead tokens: ${formatTokens(baselineTokens.overheadTokens)}`
    );
    console.log("   ──────────────────────────────────────────────────");
    console.log(`   TOTAL TOKENS: ${formatTokens(baselineTokens.totalTokens)}`);

    // Dynamic scenario: Search + relevant tools
    console.log("\n📊 Scenario B: Dynamic (Search + Load Relevant Tools)");
    const dynamicResults: ScenarioResult[] = [];

    let totalDynamicTokens = 0;
    let totalRelevantTools = 0;

    // Load queries from pre-prepared tests or generate dynamically
    const queries = await this.loadQueriesForBenchmark();

    for (const query of queries) {
      const searchResponse = await this.searchService.search({
        query,
        topK: 3,
      });

      const searchResults = this.extractResults(searchResponse);
      const relevantToolNames = searchResults.map((r) => r.name);
      const relevantTools = this.allTools.filter((tool) =>
        relevantToolNames.includes(tool.name)
      );

      const dynamicTokens = await calculateScenarioTokens(relevantTools, {
        model: this.config.model,
        includeOverhead: true,
      });

      totalDynamicTokens += dynamicTokens.totalTokens;
      totalRelevantTools += relevantTools.length;

      console.log(`\n   Query: "${query}"`);
      console.log(`   Tools found: ${relevantToolNames.join(", ")}`);
      console.log(`   Tokens: ${formatTokens(dynamicTokens.totalTokens)}`);

      dynamicResults.push({
        name: `Dynamic: ${query}`,
        description: `Query: ${query}`,
        tools: relevantTools,
        tokens: dynamicTokens,
        savings: null,
      });
    }

    const avgDynamicTokens = Math.floor(totalDynamicTokens / queries.length);
    const avgRelevantTools = Math.floor(totalRelevantTools / queries.length);

    console.log("\n   ──────────────────────────────────────────────────");
    console.log(`   Average tools loaded: ${avgRelevantTools}`);
    console.log(`   Average tokens: ${formatTokens(avgDynamicTokens)}`);

    const dynamic: ScenarioResult = {
      name: "Dynamic (Filtered Tools)",
      description: "Dynamic approach: search + load only relevant tools",
      tools: this.allTools, // Placeholder - tools vary per query
      tokens: {
        rawToolTokens: avgDynamicTokens - CONTEXT_OVERHEAD.system_message,
        overheadTokens: CONTEXT_OVERHEAD.system_message,
        totalTokens: avgDynamicTokens,
        charCount: 0,
        toolCount: avgRelevantTools,
      },
      savings: null,
    };

    // Calculate savings
    const tokensSaved = baselineTokens.totalTokens - avgDynamicTokens;
    const percentageSaved =
      baselineTokens.totalTokens > 0
        ? (tokensSaved / baselineTokens.totalTokens) * 100
        : 0;

    const baselineCost = await estimateApiCost(
      baselineTokens.totalTokens,
      100,
      this.config.model
    );
    const dynamicCost = await estimateApiCost(
      avgDynamicTokens,
      100,
      this.config.model
    );

    const savings: SavingsMetrics = {
      tokensSaved,
      percentageSaved: Number(percentageSaved.toFixed(2)),
      absoluteTokens: tokensSaved,
      costSaved: Number(
        (baselineCost.totalCost - dynamicCost.totalCost).toFixed(6)
      ),
      model: this.config.model,
    };

    return { baseline, dynamic, savings };
  }

  /**
   * Runs validation tests to ensure correct tool selection.
   */
  async runValidation(): Promise<BenchmarkReport> {
    console.log(`\n${"=".repeat(70)}`);
    console.log("CLAUDE TOOL SEARCH VALIDATION");
    console.log("=".repeat(70));

    const report = await generateBenchmarkReport(
      this.allTools,
      async (query: string) => {
        const response = await this.searchService.search({ query, topK: 5 });
        return this.extractResults(response);
      }
    );

    console.log(formatBenchmarkReport(report));

    return report;
  }

  /**
   * Runs load tests for performance measurement.
   */
  async runPerformanceTest(): Promise<LoadTestResult> {
    console.log(`\n${"=".repeat(70)}`);
    console.log("LOAD TEST");
    console.log("=".repeat(70));

    const toolSelector = async (
      _query: string
    ): Promise<{ tools: ToolDefinition[] }> => {
      const searchResponse = await this.searchService.search({
        query: "test query",
        topK: 3,
      });

      const searchResults = this.extractResults(searchResponse);
      const relevantToolNames = searchResults.map((r) => r.name);
      const tools = this.allTools.filter((tool) =>
        relevantToolNames.includes(tool.name)
      );

      return { tools };
    };

    // Generate test queries
    const queries = new Array(this.config.loadTestConfig.iterations)
      .fill(null)
      .map((_, i) => `test query ${i + 1}`);

    const result = await runLoadTest(
      toolSelector,
      queries,
      this.config.loadTestConfig.concurrentRequests
    );

    console.log(formatLoadTestResult(result));

    return result;
  }

  /**
   * Analyzes tool token usage.
   */
  async analyzeToolUsage(): Promise<{
    topConsumers: Array<{ name: string; tokens: number; percentage: number }>;
    totalTokens: number;
  }> {
    console.log(`\n${"=".repeat(70)}`);
    console.log("TOOL TOKEN ANALYSIS");
    console.log("=".repeat(70));

    const [analysis, totalTokens] = await Promise.all([
      analyzeToolTokens(this.allTools),
      countToolsTokens(this.allTools),
    ]);

    const topConsumers = analysis.slice(0, 10).map((item) => ({
      name: item.tool.name,
      tokens: item.tokens,
      percentage: Number(item.percentageOfTotal.toFixed(2)),
    }));

    console.log("\n🔝 Top 10 Token Consumers:");
    console.log(`   ${"-".repeat(60)}`);

    for (const tool of topConsumers) {
      const bar = "█".repeat(Math.ceil(tool.percentage / 2));
      console.log(
        `   ${tool.name.padEnd(30)} ${bar.padEnd(50)} ${tool.percentage.toFixed(1)}%`
      );
    }

    console.log(
      `\n   Total tokens for all tools: ${formatTokens(totalTokens)}`
    );

    return { topConsumers, totalTokens };
  }

  /**
   * Projects savings over time.
   */
  async projectSavingsOverTime(
    savingsPerQuery: number,
    baselineTokensPerQuery?: number
  ): Promise<{
    daily: Awaited<ReturnType<typeof import("./calculator").projectSavings>>;
    weekly: Awaited<ReturnType<typeof import("./calculator").projectSavings>>;
    monthly: Awaited<ReturnType<typeof import("./calculator").projectSavings>>;
    annual: Awaited<ReturnType<typeof import("./calculator").projectSavings>>;
  }> {
    console.log(`\n${"=".repeat(70)}`);
    console.log("SAVINGS PROJECTIONS");
    console.log("=".repeat(70));

    // Use provided baseline or estimate from savings (assume ~97% reduction)
    const baselineTokens = baselineTokensPerQuery ?? savingsPerQuery * 30;
    const dynamicTokens = baselineTokens - savingsPerQuery;

    // Calculate costs per query
    const baselineCost = await estimateApiCost(
      baselineTokens,
      0,
      this.config.model
    );
    const dynamicCost = await estimateApiCost(
      dynamicTokens,
      0,
      this.config.model
    );
    const savingsPerQueryCost = baselineCost.totalCost - dynamicCost.totalCost;

    console.log(`\n💰 Per-Query Cost Breakdown (${this.config.model})`);
    console.log(
      `   Without optimization: $${baselineCost.totalCost.toFixed(6)} (${formatTokens(baselineTokens)} tool tokens)`
    );
    console.log(
      `   With optimization:    $${dynamicCost.totalCost.toFixed(6)} (${formatTokens(dynamicTokens)} tool tokens)`
    );
    console.log(`   Savings per query:    $${savingsPerQueryCost.toFixed(6)}`);

    // Daily projections (100 queries/day)
    const queriesPerDay = 100;
    const dailyBaselineCost = baselineCost.totalCost * queriesPerDay;
    const dailyDynamicCost = dynamicCost.totalCost * queriesPerDay;
    const dailySavings = savingsPerQueryCost * queriesPerDay;

    console.log(`\n📅 Daily Cost (at ${queriesPerDay} queries/day)`);
    console.log(`   Without optimization: $${dailyBaselineCost.toFixed(2)}`);
    console.log(`   With optimization:    $${dailyDynamicCost.toFixed(2)}`);
    console.log(`   Daily savings:        $${dailySavings.toFixed(2)}`);

    // Monthly projections (30 days)
    const daysPerMonth = 30;
    const monthlyBaselineCost = dailyBaselineCost * daysPerMonth;
    const monthlyDynamicCost = dailyDynamicCost * daysPerMonth;
    const monthlySavings = dailySavings * daysPerMonth;

    console.log(`\n📆 Monthly Cost (at ${queriesPerDay} queries/day)`);
    console.log(`   Without optimization: $${monthlyBaselineCost.toFixed(2)}`);
    console.log(`   With optimization:    $${monthlyDynamicCost.toFixed(2)}`);
    console.log(`   Monthly savings:      $${monthlySavings.toFixed(2)}`);

    // Annual projections
    const daysPerYear = 365;
    const annualBaselineCost = dailyBaselineCost * daysPerYear;
    const annualDynamicCost = dailyDynamicCost * daysPerYear;
    const annualSavings = dailySavings * daysPerYear;

    console.log(`\n📈 Annual Cost (at ${queriesPerDay} queries/day)`);
    console.log(`   Without optimization: $${annualBaselineCost.toFixed(2)}`);
    console.log(`   With optimization:    $${annualDynamicCost.toFixed(2)}`);
    console.log(`   Annual savings:       $${annualSavings.toFixed(2)}`);

    console.log("\n📊 Token Savings Projection");
    console.log(`   Per query: ${formatTokens(savingsPerQuery)}`);
    const { projectSavings: calcProjectSavings } = await import(
      "./calculator.js"
    );
    const daily = await calcProjectSavings(
      savingsPerQuery,
      queriesPerDay,
      this.config.model
    );
    const weekly = await calcProjectSavings(
      savingsPerQuery,
      queriesPerDay * 7,
      this.config.model
    );
    const monthly = await calcProjectSavings(
      savingsPerQuery,
      queriesPerDay * daysPerMonth,
      this.config.model
    );
    const annual = await calcProjectSavings(
      savingsPerQuery,
      queriesPerDay * daysPerYear,
      this.config.model
    );
    console.log(
      `   Daily (${queriesPerDay} queries): ${formatTokens(savingsPerQuery * queriesPerDay)}`
    );
    console.log(
      `   Monthly: ${formatTokens(savingsPerQuery * queriesPerDay * daysPerMonth)}`
    );
    console.log(
      `   Annual: ${formatTokens(savingsPerQuery * queriesPerDay * daysPerYear)}`
    );

    return { daily, weekly, monthly, annual };
  }

  /**
   * Runs the complete benchmark suite.
   */
  async run(
    toolLoader: () => Promise<ToolDefinition[]>
  ): Promise<BenchmarkResults> {
    console.log("\n🚀 Starting Tool Search MCP Benchmark Suite\n");
    console.log("=".repeat(70));
    console.log("TOOL SEARCH MCP BENCHMARK SUITE");
    console.log(`Model: ${this.config.model}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log("=".repeat(70));

    // Load tools
    await this.loadTools(toolLoader);

    // Run token comparison
    const tokenComparison = await this.runTokenComparison();

    // Run validation (optional - may be skipped if no tools available)
    let validation: BenchmarkReport | null = null;
    try {
      validation = await this.runValidation();
    } catch (error) {
      console.log(`\n⚠️ Validation tests skipped due to error: ${error}`);
    }

    // Run load test
    let loadTest: LoadTestResult | null = null;
    try {
      loadTest = await this.runPerformanceTest();
    } catch (error) {
      console.log(`\n⚠️ Load test skipped due to error: ${error}`);
    }

    // Analyze tool usage
    const toolAnalysis = await this.analyzeToolUsage();

    // Project savings
    const projections = await this.projectSavingsOverTime(
      tokenComparison.savings.tokensSaved,
      tokenComparison.baseline.tokens.totalTokens
    );

    // Print final summary
    console.log(`\n${"=".repeat(70)}`);
    console.log("BENCHMARK SUMMARY");
    console.log("=".repeat(70));
    console.log("\n📊 Token Savings");
    console.log(
      `   Baseline (all tools): ${formatTokens(tokenComparison.baseline.tokens.totalTokens)}`
    );
    console.log(
      `   Dynamic (filtered): ${formatTokens(tokenComparison.dynamic.tokens.totalTokens)}`
    );
    console.log(
      `   Tokens saved: ${formatTokens(tokenComparison.savings.tokensSaved)}`
    );
    console.log(
      `   Percentage: ${tokenComparison.savings.percentageSaved.toFixed(1)}%`
    );

    console.log("\n💰 Cost Savings (per query)");
    console.log(
      `   Cost saved: $${tokenComparison.savings.costSaved.toFixed(6)}`
    );
    console.log(`   Model: ${tokenComparison.savings.model}`);

    if (validation) {
      console.log("\n✅ Validation Results");
      console.log(
        `   Baseline Pass Rate: ${validation.baselineMode.passRate.toFixed(1)}%`
      );
      console.log(
        `   Search Pass Rate: ${validation.searchMode.passRate.toFixed(1)}%`
      );
      console.log(
        `   Baseline Match Score: ${validation.baselineMode.avgMatchScore.toFixed(1)}%`
      );
      console.log(
        `   Search Match Score: ${validation.searchMode.avgMatchScore.toFixed(1)}%`
      );
      console.log(
        `   Tokens Saved/Query: ${validation.comparison.avgTokensSaved}`
      );
      console.log(
        `   Token Reduction: ${validation.comparison.avgTokenReduction.toFixed(1)}%`
      );
    }

    if (loadTest) {
      console.log("\n⚡ Load Test Results");
      console.log(
        `   Success rate: ${((loadTest.successfulRequests / loadTest.totalRequests) * 100).toFixed(1)}%`
      );
      console.log(
        `   Average latency: ${loadTest.averageLatency.toFixed(2)}ms`
      );
      console.log(`   Throughput: ${loadTest.throughput.toFixed(2)} req/s`);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log("✅ Benchmark Complete!");
    console.log(`${"=".repeat(70)}\n`);

    return {
      metadata: {
        timestamp: new Date().toISOString(),
        model: this.config.model,
        totalTools: this.allTools.length,
      },
      tokenComparison,
      validation,
      loadTest,
      toolAnalysis,
      projections,
    };
  }
}

/**
 * Creates a benchmark runner with default configuration.
 */
export function createBenchmarkRunner(
  searchService: {
    search: (params: {
      query: string;
      topK?: number;
    }) => Promise<SearchResult[]>;
    reload: (tools: ToolDefinition[]) => Promise<void>;
  },
  config?: Partial<BenchmarkConfig>
): BenchmarkRunner {
  return new BenchmarkRunner(searchService, config);
}
