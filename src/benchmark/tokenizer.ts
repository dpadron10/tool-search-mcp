/**
 * Anthropic Tokenizer Module
 *
 * Uses Anthropic's official Messages API for accurate token counting.
 * Reference: https://platform.claude.com/docs/en/build-with-claude/token-counting
 *
 * Features:
 * - Official Anthropic token counting API via client.messages.countTokens()
 * - Supports system prompts, tools, images, PDFs, and extended thinking
 * - Free to use (subject to RPM rate limits)
 * - Provides estimates (actual tokens may differ slightly)
 * - Does NOT use prompt caching (pure estimate)
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition } from "../search";
import { getModelTokenLimits, getPricingRates } from "./anthropic-models";

/**
 * Default model for token counting.
 * Will be dynamically resolved to latest Sonnet model.
 */
let resolvedDefaultModel: string | null = null;

/**
 * Resolves and caches the default model ID.
 */
export async function getResolvedDefaultModel(): Promise<string> {
  if (!resolvedDefaultModel) {
    try {
      const { getDefaultModel } = await import("./anthropic-models.js");
      const defaultModel = await getDefaultModel();
      resolvedDefaultModel = defaultModel.id;
    } catch {
      resolvedDefaultModel = "claude-sonnet-4-5-20250929";
    }
  }
  return resolvedDefaultModel;
}

/**
 * Model token limits for context window calculations.
 * Dynamically populated from Anthropic documentation.
 */
let modelTokenLimits: Record<string, number> = {
  "claude-sonnet-4-5-20250929": 200_000,
  "claude-sonnet-4-20250514": 200_000,
  "claude-sonnet-4-20250506": 200_000,
  "claude-opus-4-20250514": 200_000,
  "claude-opus-4-20250506": 200_000,
  "claude-haiku-3-20250514": 200_000,
  "claude-haiku-3-20250506": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-sonnet-20240620": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-3-sonnet-20240229": 200_000,
  "claude-3-haiku-20240229": 200_000,
  default: 180_000,
};

/**
 * Loads token limits from dynamic source.
 */
export async function loadModelTokenLimits(): Promise<Record<string, number>> {
  try {
    modelTokenLimits = await getModelTokenLimits();
  } catch {
    // Keep defaults if fetch fails
  }
  return modelTokenLimits;
}

/**
 * Gets MODEL_TOKEN_LIMITS (lazy-loaded).
 */
export async function getModelTokenLimitsLazy(): Promise<
  Record<string, number>
> {
  await loadModelTokenLimits();
  return modelTokenLimits;
}

export { modelTokenLimits as MODEL_TOKEN_LIMITS };

/**
 * Rate limits for token counting API.
 * Reference: https://platform.claude.com/docs/en/build-with-claude/token-counting#pricing-and-rate-limits
 */
export const TOKEN_COUNTING_RPM = {
  tier1: 100,
  tier2: 2000,
  tier3: 4000,
  tier4: 8000,
};

/**
 * Creates an Anthropic client for token counting.
 * Returns null if no API key is available.
 */
function createAnthropicClient(): Anthropic | null {
  // Check if API key is available
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new Anthropic({ apiKey });
}

/**
 * Checks if the Anthropic API is available (has valid credentials).
 */
export function isAnthropicApiAvailable(): boolean {
  return createAnthropicClient() !== null;
}

/**
 * Warns the user about API availability.
 */
export function warnAboutApiAvailability(): void {
  if (!isAnthropicApiAvailable()) {
    console.warn(
      "\n⚠️  ANTHROPIC_API_KEY not set. Using character-based estimation for token counting.\n" +
        "   Set ANTHROPIC_API_KEY environment variable for accurate token counts via Anthropic's API.\n"
    );
  }
}

/**
 * Converts internal ToolDefinition to Anthropic Tool format.
 */
function toAnthropicTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}

/**
 * Counts tokens in a complete message using Anthropic's official API.
 *
 * @param params - Token counting parameters
 * @returns Number of input tokens
 *
 * @example
 * ```typescript
 * const tokens = await countTokens({
 *   model: "claude-sonnet-4-5-20250929",
 *   system: "You are a helpful assistant.",
 *   messages: [{ role: "user", content: "Hello!" }],
 * });
 * ```
 */
export async function countTokens(params: {
  model?: string;
  system?: string;
  tools?: ToolDefinition[];
  messages?: Array<{
    role: string;
    content: string | Array<{ type: "text"; text: string }>;
  }>;
}): Promise<number> {
  const client = createAnthropicClient();
  const model = params.model ?? (await getResolvedDefaultModel());

  if (!client) {
    // Fall back to estimation
    let totalChars = 0;
    if (params.system) {
      totalChars += params.system.length;
    }
    if (params.tools) {
      totalChars += params.tools.reduce((sum, tool) => {
        return (
          sum +
          tool.name.length +
          tool.description.length +
          JSON.stringify(tool.input_schema).length
        );
      }, 0);
    }
    if (params.messages) {
      totalChars += params.messages.reduce((sum, msg) => {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : msg.content.map((c) => c.text).join("");
        return sum + content.length;
      }, 0);
    }
    return estimateTokensByChars(totalChars.toString());
  }

  const response = await client.messages.countTokens({
    model,
    system: params.system,
    tools: params.tools?.map(toAnthropicTool),
    messages: (params.messages ?? []).map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
  });

  return response.input_tokens;
}

/**
 * Counts tokens for tool definitions only.
 * Useful for measuring the token cost of tool schemas.
 *
 * @param tools - Array of tool definitions
 * @param model - Model ID for counting
 * @returns Token count for the tools
 */
export async function countToolTokens(
  tools: ToolDefinition[],
  model?: string
): Promise<number> {
  if (tools.length === 0) {
    return 0;
  }

  const resolvedModel = model ?? (await getResolvedDefaultModel());
  const client = createAnthropicClient();
  if (!client) {
    // Fall back to estimation when no API key is available
    return estimateToolsTokens(tools);
  }

  const response = await client.messages.countTokens({
    model: resolvedModel,
    tools: tools.map(toAnthropicTool),
    messages: [{ role: "user", content: "." }],
  });

  return response.input_tokens;
}

/**
 * Counts tokens for a single tool definition.
 *
 * @param tool - Single tool definition
 * @param model - Model ID for counting
 * @returns Token count for the tool
 */
export async function countSingleToolToken(
  tool: ToolDefinition,
  model?: string
): Promise<number> {
  return countToolTokens([tool], model);
}

/**
 * Counts tokens in a system message.
 *
 * @param system - System prompt text
 * @param model - Model ID for counting
 * @returns Token count for the system message
 */
export async function countSystemTokens(
  system: string,
  model?: string
): Promise<number> {
  const resolvedModel = model ?? (await getResolvedDefaultModel());
  const client = createAnthropicClient();
  if (!client) {
    return estimateTokensByChars(system);
  }

  const response = await client.messages.countTokens({
    model: resolvedModel,
    system,
    messages: [{ role: "user", content: "." }],
  });

  return response.input_tokens;
}

/**
 * Counts tokens in user/assistant messages.
 *
 * @param messages - Array of messages
 * @param model - Model ID for counting
 * @returns Token count for the messages
 */
export async function countMessageTokens(
  messages: Array<{
    role: string;
    content: string | Array<{ type: "text"; text: string }>;
  }>,
  model?: string
): Promise<number> {
  const resolvedModel = model ?? (await getResolvedDefaultModel());
  const client = createAnthropicClient();
  if (!client) {
    const totalChars = messages.reduce((sum, msg) => {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : msg.content.map((c) => c.text).join("");
      return sum + content.length;
    }, 0);
    return estimateTokensByChars(totalChars.toString());
  }

  const response = await client.messages.countTokens({
    model: resolvedModel,
    messages: messages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
  });

  return response.input_tokens;
}

/**
 * Estimates token count using character-based approximation.
 * Falls back to this when API is unavailable or for quick estimates.
 * Based on ~4 characters per token for English text.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokensByChars(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Counts tokens in a tool definition using estimation.
 * Used as fallback when API is unavailable.
 *
 * @param tool - Tool definition
 * @returns Estimated token count
 */
export function estimateToolTokens(tool: ToolDefinition): number {
  const content = [
    tool.name,
    tool.description,
    JSON.stringify(tool.input_schema),
  ].join(" ");
  return estimateTokensByChars(content);
}

/**
 * Counts tokens in multiple tools using estimation.
 *
 * @param tools - Array of tool definitions
 * @returns Total estimated token count
 */
export function estimateToolsTokens(tools: ToolDefinition[]): number {
  return tools.reduce((total, tool) => total + estimateToolTokens(tool), 0);
}

/**
 * Formats token count for display.
 *
 * @param tokens - Token count
 * @returns Human-readable formatted string
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Creates a token breakdown for analysis.
 * Uses official API when available, falls back to estimation.
 *
 * @param tools - Tool definitions
 * @param system - Optional system prompt
 * @param messages - Optional conversation messages
 * @param model - Model ID for counting
 * @returns Detailed token breakdown
 */
export async function createTokenBreakdown(
  tools: ToolDefinition[],
  system?: string,
  messages?: Array<{
    role: string;
    content: string | Array<{ type: "text"; text: string }>;
  }>,
  model?: string
): Promise<{
  toolTokens: number;
  systemTokens: number;
  messageTokens: number;
  totalTokens: number;
  toolCount: number;
}> {
  const resolvedModel = model ?? (await getResolvedDefaultModel());
  const [toolTokens, systemTokens, messageTokens] = await Promise.all([
    countToolTokens(tools, resolvedModel),
    system ? countSystemTokens(system, resolvedModel) : Promise.resolve(0),
    messages ? countMessageTokens(messages, resolvedModel) : Promise.resolve(0),
  ]);

  return {
    toolTokens,
    systemTokens,
    messageTokens,
    totalTokens: toolTokens + systemTokens + messageTokens,
    toolCount: tools.length,
  };
}

/**
 * Dynamic pricing rates loaded from Anthropic models.
 */
let pricingRates: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5-20251101": { input: 5, output: 25 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-3-20250514": { input: 0.25, output: 1.25 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-sonnet-20240620": { input: 3, output: 15 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  "claude-3-sonnet-20240229": { input: 3, output: 15 },
  "claude-3-haiku-20240229": { input: 0.25, output: 1.25 },
};

/**
 * Loads pricing rates from dynamic source.
 */
async function loadPricingRates(): Promise<
  Record<string, { input: number; output: number }>
> {
  try {
    pricingRates = await getPricingRates();
  } catch {
    // Keep defaults if fetch fails
  }
  return pricingRates;
}

/**
 * Estimates API cost based on token usage.
 * Note: These rates are approximate and may vary.
 *
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens (estimated)
 * @param model - Model ID for pricing
 * @returns Estimated cost breakdown
 */
export async function estimateApiCost(
  inputTokens: number,
  outputTokens = 100,
  model?: string
): Promise<{
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}> {
  const resolvedModel = model ?? (await getResolvedDefaultModel());

  // Load dynamic pricing rates
  const rates = await loadPricingRates();
  const rate = rates[resolvedModel] ?? rates["claude-sonnet-4-5-20250929"];

  const inputCost = (inputTokens / 1_000_000) * rate.input;
  const outputCost = (outputTokens / 1_000_000) * rate.output;

  return {
    inputCost: Number(inputCost.toFixed(6)),
    outputCost: Number(outputCost.toFixed(6)),
    totalCost: Number((inputCost + outputCost).toFixed(6)),
    currency: "USD",
  };
}

/**
 * Configuration for token counting behavior.
 */
export interface TokenCountingConfig {
  /** Use official API instead of estimation */
  useApi?: boolean;
  /** Model to use for counting */
  model?: string;
  /** API timeout in ms */
  timeout?: number;
  /** Fallback to estimation on API error */
  fallback?: boolean;
}

/**
 * Default configuration values.
 */
const DEFAULT_TOKEN_CONFIG: Required<Omit<TokenCountingConfig, "model">> & {
  model: string;
} = {
  useApi: true,
  model: "claude-sonnet-4-5-20250929", // Will be overridden by dynamic resolver
  timeout: 5000,
  fallback: true,
};

/**
 * Counts tokens with configuration options.
 * Automatically falls back to estimation if API fails.
 *
 * @param tools - Tool definitions
 * @param config - Configuration options
 * @returns Token count (or null if all methods fail)
 */
export async function countToolsTokens(
  tools: ToolDefinition[],
  config?: TokenCountingConfig
): Promise<number> {
  const model = config?.model ?? (await getResolvedDefaultModel());
  const resolvedConfig = { ...DEFAULT_TOKEN_CONFIG, ...config, model };

  // Use API if enabled
  if (resolvedConfig.useApi) {
    try {
      return await countToolTokens(tools, resolvedConfig.model);
    } catch (error) {
      if (!resolvedConfig.fallback) {
        throw error;
      }
      // Fall through to estimation
    }
  }

  // Fallback to estimation
  return estimateToolsTokens(tools);
}
