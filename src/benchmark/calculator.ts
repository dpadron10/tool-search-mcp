/**
 * Token Calculator Module
 *
 * Provides comprehensive token calculation utilities for comparing
 * different tool loading strategies and measuring context savings.
 */

import type { ToolDefinition } from "../search";
import {
  countToolsTokens,
  countToolTokens,
  estimateApiCost,
  formatTokens,
  getResolvedDefaultModel,
} from "./tokenizer";

/**
 * Token overhead for context elements (per Anthropic's token counting).
 */
export const CONTEXT_OVERHEAD = {
  system_message: 30,
  tool_header: 15,
  tool_description: 10,
};

/**
 * Represents a benchmark scenario with its tools and token metrics.
 */
export interface ScenarioResult {
  name: string;
  description: string;
  tools: ToolDefinition[];
  tokens: TokenMetrics;
  savings: SavingsMetrics | null;
}

/**
 * Token metrics for a scenario.
 */
export interface TokenMetrics {
  rawToolTokens: number;
  overheadTokens: number;
  totalTokens: number;
  charCount: number;
  toolCount: number;
}

/**
 * Savings metrics comparing two scenarios.
 */
export interface SavingsMetrics {
  tokensSaved: number;
  percentageSaved: number;
  absoluteTokens: number;
  costSaved: number;
  model: string;
}

/**
 * Configuration for token calculation.
 */
export interface CalculationConfig {
  model?: string;
  includeOverhead?: boolean;
  compareWithBaseline?: ScenarioResult;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<Omit<CalculationConfig, "model">> & {
  model: string;
} = {
  model: "claude-sonnet-4-5-20250929", // Will be resolved dynamically
  includeOverhead: true,
  compareWithBaseline: null as unknown as ScenarioResult,
};

/**
 * Calculates token metrics for a given set of tools.
 *
 * @param tools - Array of tool definitions
 * @param config - Calculation configuration
 * @returns Token metrics for the scenario
 */
export async function calculateScenarioTokens(
  tools: ToolDefinition[],
  config: CalculationConfig = {}
): Promise<TokenMetrics> {
  const resolvedModel = config.model ?? (await getResolvedDefaultModel());
  const resolvedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    model: resolvedModel,
  };
  const { includeOverhead } = resolvedConfig;

  const rawToolTokens = await countToolsTokens(tools);
  const overheadTokens = includeOverhead ? CONTEXT_OVERHEAD.system_message : 0;
  const totalTokens = rawToolTokens + overheadTokens;

  const charCount = tools.reduce((sum, tool) => {
    const toolDump = [
      tool.name,
      tool.description,
      JSON.stringify(tool.input_schema),
    ].join(" ");
    return sum + toolDump.length;
  }, 0);

  return {
    rawToolTokens,
    overheadTokens,
    totalTokens,
    charCount,
    toolCount: tools.length,
  };
}

/**
 * Calculates savings between a scenario and baseline.
 *
 * @param scenario - The scenario to calculate savings for
 * @param baseline - The baseline scenario to compare against
 * @param model - Model ID for cost estimation
 * @returns Savings metrics
 */
export async function calculateSavings(
  scenario: ScenarioResult,
  baseline: ScenarioResult,
  model?: string
): Promise<SavingsMetrics> {
  const resolvedModel = model ?? (await getResolvedDefaultModel());
  const baselineTokens = baseline.tokens.totalTokens;
  const scenarioTokens = scenario.tokens.totalTokens;

  const tokensSaved = baselineTokens - scenarioTokens;
  const percentageSaved =
    baselineTokens > 0 ? (tokensSaved / baselineTokens) * 100 : 0;

  const baselineCost = await estimateApiCost(
    baselineTokens,
    100,
    resolvedModel
  );
  const scenarioCost = await estimateApiCost(
    scenarioTokens,
    100,
    resolvedModel
  );

  const costSaved = baselineCost.totalCost - scenarioCost.totalCost;

  return {
    tokensSaved,
    percentageSaved: Number(percentageSaved.toFixed(2)),
    absoluteTokens: tokensSaved,
    costSaved: Number(costSaved.toFixed(6)),
    model: resolvedModel,
  };
}

/**
 * Creates a scenario result object.
 *
 * @param name - Scenario name
 * @param description - Scenario description
 * @param tools - Tools in this scenario
 * @param config - Calculation configuration
 * @returns Complete scenario result
 */
export async function createScenario(
  name: string,
  description: string,
  tools: ToolDefinition[],
  config: CalculationConfig = {}
): Promise<ScenarioResult> {
  const resolvedModel = config.model ?? (await getResolvedDefaultModel());
  const resolvedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    model: resolvedModel,
  };
  const metrics = await calculateScenarioTokens(tools, resolvedConfig);

  let savings: SavingsMetrics | null = null;
  if (resolvedConfig.compareWithBaseline) {
    savings = await calculateSavings(
      { name, description, tools, tokens: metrics, savings: null },
      resolvedConfig.compareWithBaseline,
      resolvedConfig.model
    );
  }

  return {
    name,
    description,
    tools,
    tokens: metrics,
    savings,
  };
}

/**
 * Compares multiple scenarios and generates a comparison report.
 *
 * @param scenarios - Array of scenarios to compare
 * @param baselineIndex - Index of the baseline scenario (default: 0)
 * @returns Comparison report
 */
export async function compareScenarios(
  scenarios: ScenarioResult[],
  baselineIndex = 0
): Promise<{
  baseline: ScenarioResult;
  comparisons: Array<{
    scenario: ScenarioResult;
    savings: SavingsMetrics;
    efficiency: number;
  }>;
  summary: {
    totalScenarios: number;
    avgTokens: number;
    bestScenario: ScenarioResult | null;
    bestSavings: number;
  };
}> {
  const baseline = scenarios[baselineIndex];
  if (!baseline) {
    throw new Error(`Baseline scenario at index ${baselineIndex} not found`);
  }

  const comparisons = await Promise.all(
    scenarios
      .filter((_, idx) => idx !== baselineIndex)
      .map(async (scenario) => {
        const savings = await calculateSavings(
          scenario,
          baseline,
          baseline.savings?.model
        );
        const efficiency =
          scenario.tokens.totalTokens > 0
            ? (savings.tokensSaved / baseline.tokens.totalTokens) * 100
            : 0;

        return { scenario, savings, efficiency };
      })
  );

  const totalTokens = scenarios.reduce(
    (sum, s) => sum + s.tokens.totalTokens,
    0
  );
  const avgTokens = Math.floor(totalTokens / scenarios.length);

  const bestComparison =
    comparisons.length > 0
      ? comparisons.reduce((best, current) =>
          current.savings.tokensSaved > best.savings.tokensSaved
            ? current
            : best
        )
      : null;

  return {
    baseline,
    comparisons,
    summary: {
      totalScenarios: scenarios.length,
      avgTokens,
      bestScenario: bestComparison?.scenario ?? null,
      bestSavings: bestComparison?.savings.tokensSaved ?? 0,
    },
  };
}

/**
 * Generates a detailed token breakdown for display.
 *
 * @param scenario - Scenario to analyze
 * @returns Formatted breakdown string
 */
export function formatScenarioBreakdown(scenario: ScenarioResult): string {
  const lines: string[] = [];

  lines.push(`\n📊 Token Breakdown for: ${scenario.name}`);
  lines.push(`   ${"=".repeat(50)}`);
  lines.push(`   Description: ${scenario.description}`);
  lines.push(`   Tools loaded: ${scenario.tokens.toolCount}`);
  lines.push(
    `   Character count: ${scenario.tokens.charCount.toLocaleString()}`
  );
  lines.push(
    `   Raw tool tokens: ${formatTokens(scenario.tokens.rawToolTokens)}`
  );
  lines.push(
    `   Overhead tokens: ${formatTokens(scenario.tokens.overheadTokens)}`
  );
  lines.push("   ──────────────────────────────────────────────────");
  lines.push(`   TOTAL TOKENS: ${formatTokens(scenario.tokens.totalTokens)}`);
  lines.push(`   ${"=".repeat(50)}`);

  if (scenario.savings) {
    lines.push(`\n💰 Cost Analysis (${scenario.savings.model})`);
    lines.push(
      `   Tokens saved: ${formatTokens(scenario.savings.tokensSaved)}`
    );
    lines.push(
      `   Percentage: ${scenario.savings.percentageSaved.toFixed(1)}%`
    );
    lines.push(`   Cost saved: $${scenario.savings.costSaved.toFixed(4)}`);
  }

  return lines.join("\n");
}

/**
 * Per-tool token analysis for optimization insights.
 */
export interface ToolTokenAnalysis {
  tool: ToolDefinition;
  tokens: number;
  charCount: number;
  percentageOfTotal: number;
}

/**
 * Analyzes individual tool token usage.
 *
 * @param tools - Array of tool definitions
 * @returns Per-tool token analysis
 */
export async function analyzeToolTokens(
  tools: ToolDefinition[]
): Promise<ToolTokenAnalysis[]> {
  const totalTokens = await countToolsTokens(tools);

  const analyses = await Promise.all(
    tools.map(async (tool) => {
      const tokens = await countToolTokens([tool]);
      const charCount = [
        tool.name,
        tool.description,
        JSON.stringify(tool.input_schema),
      ].join(" ").length;
      const percentageOfTotal =
        totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;

      return { tool, tokens, charCount, percentageOfTotal };
    })
  );

  return analyses.sort((a, b) => b.tokens - a.tokens);
}

/**
 * Identifies tools that contribute most to token usage.
 *
 * @param tools - Array of tool definitions
 * @param topN - Number of top tools to return
 * @returns Top N token-heavy tools
 */
export async function getTopTokenConsumers(
  tools: ToolDefinition[],
  topN = 10
): Promise<ToolTokenAnalysis[]> {
  const analysis = await analyzeToolTokens(tools);
  return analysis.slice(0, topN);
}

/**
 * Projects token savings over multiple queries.
 */
export interface ProjectionResult {
  queryCount: number;
  tokensPerQuery: number;
  totalTokens: number;
  costEstimate: number;
  annualSavings: number;
  model: string;
}

/**
 * Environmental impact metrics for nature savings.
 * Based on estimates from ML emissions research.
 */
export interface NatureSavings {
  /** CO2 emissions saved in kg */
  co2Kg: number;
  /** Energy saved in kWh */
  energyKwh: number;
  /** Water usage saved in liters (for cooling) */
  waterLiters: number;
  /** Trees equivalent (annual CO2 absorption) */
  treesEquivalent: number;
  /** Data center impact avoided */
  dataCenterImpact: string;
}

/**
 * Extended projection result with nature savings.
 */
export interface ExtendedProjectionResult extends ProjectionResult {
  nature: NatureSavings;
}

/**
 * Carbon emission factors per token (approximate, based on LLM inference research).
 * Sources: AI Emissions Calculator, MLCO2 Impact, Science papers on LLM carbon footprint.
 *
 * Approximate breakdown per 1M tokens:
 * - Energy: ~0.4-1.2 kWh (varies by model efficiency, hardware)
 * - CO2: ~0.2-0.6 kg (grid average)
 * - Water: ~1-3 liters (for cooling data centers)
 */
const NATURE_FACTORS = {
  co2PerMillionTokens: 0.4, // kg CO2 per million tokens
  energyPerMillionTokens: 0.8, // kWh per million tokens
  waterPerMillionTokens: 2, // liters per million tokens
  treesAnnualCo2Absorption: 22, // kg CO2 absorbed by one tree per year
};

/**
 * Calculate nature savings from token savings.
 */
export function calculateNatureSavings(tokensSaved: number): NatureSavings {
  const millionsSaved = tokensSaved / 1_000_000;

  const co2Kg = millionsSaved * NATURE_FACTORS.co2PerMillionTokens;
  const energyKwh = millionsSaved * NATURE_FACTORS.energyPerMillionTokens;
  const waterLiters = millionsSaved * NATURE_FACTORS.waterPerMillionTokens;

  const treesEquivalent = co2Kg / NATURE_FACTORS.treesAnnualCo2Absorption;

  // Data center impact description
  let dataCenterImpact: string;
  if (co2Kg < 1) {
    dataCenterImpact = "Minimal - equivalent to charging a smartphone";
  } else if (co2Kg < 10) {
    dataCenterImpact = "Small - equivalent to driving a few miles";
  } else if (co2Kg < 100) {
    dataCenterImpact =
      "Moderate - equivalent to a cross-country flight portion";
  } else {
    dataCenterImpact = "Significant - equivalent to a full flight or more";
  }

  return {
    co2Kg: Number(co2Kg.toFixed(4)),
    energyKwh: Number(energyKwh.toFixed(4)),
    waterLiters: Number(waterLiters.toFixed(4)),
    treesEquivalent: Number(treesEquivalent.toFixed(4)),
    dataCenterImpact,
  };
}

/**
 * Projects savings over time with nature/environmental metrics.
 *
 * @param savingsPerQuery - Token savings per query
 * @param dailyQueries - Average queries per day
 * @param model - Model ID for cost calculation
 * @returns Extended projection result with nature savings
 */
export async function projectSavingsWithNature(
  savingsPerQuery: number,
  dailyQueries = 100,
  model?: string
): Promise<ExtendedProjectionResult> {
  const resolvedModel = model ?? (await getResolvedDefaultModel());
  const baseProjection = await projectSavings(
    savingsPerQuery,
    dailyQueries,
    resolvedModel
  );
  const nature = calculateNatureSavings(baseProjection.totalTokens);

  return {
    ...baseProjection,
    nature,
  };
}

/**
 * Projects savings over time based on query volume.
 *
 * @param savingsPerQuery - Token savings per query
 * @param dailyQueries - Average queries per day
 * @param model - Model ID for cost calculation
 * @returns Projection result
 */
export async function projectSavings(
  savingsPerQuery: number,
  dailyQueries = 100,
  model?: string
): Promise<ProjectionResult> {
  const resolvedModel = model ?? (await getResolvedDefaultModel());
  const daysPerYear = 365;
  const queryCount = dailyQueries * daysPerYear;
  const totalTokens = savingsPerQuery * queryCount;
  // Only count input tokens saved - output tokens are Claude's response, unaffected by tool count
  const cost = await estimateApiCost(totalTokens, 0, resolvedModel);

  return {
    queryCount,
    tokensPerQuery: savingsPerQuery,
    totalTokens,
    costEstimate: cost.totalCost,
    annualSavings: cost.totalCost,
    model: resolvedModel,
  };
}
