/**
 * Tool Description Rewriter
 *
 * Enhances tool descriptions for better semantic search matching.
 * Uses AI to rewrite descriptions to be more searchable.
 *
 * Features:
 * - Caches rewritten descriptions to avoid repeated API calls
 * - Can be disabled via DISABLE_REWRITE=true env var
 * - Works with any AI assistant via MCP tool interface
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition } from "./search/types";

/**
 * Options for the rewriter.
 */
export interface RewriteOptions {
  /** Enable or disable rewriting */
  enabled: boolean;
  /** Cache rewritten descriptions */
  cacheResults: boolean;
  /** Path to cache file */
  cachePath?: string;
}

/**
 * Cached description entry.
 */
interface CacheEntry {
  originalHash: string;
  rewrittenDescription: string;
  timestamp: number;
}

/**
 * Cache structure.
 */
interface DescriptionCache {
  version: string;
  entries: Record<string, CacheEntry>;
}

const DEFAULT_CACHE_PATH = ".tool-search-mcp/cache/descriptions.json";
const CACHE_VERSION = "1.0";

/**
 * Default rewrite options.
 */
const DEFAULT_OPTIONS: RewriteOptions = {
  enabled: process.env.DISABLE_REWRITE !== "true",
  cacheResults: true,
  cachePath: DEFAULT_CACHE_PATH,
};

/**
 * Hash a string using SHA-256.
 */
function hashString(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

/**
 * Load the description cache from disk.
 */
async function loadCache(cachePath: string): Promise<DescriptionCache> {
  try {
    const data = await fs.readFile(cachePath, "utf-8");
    const cache = JSON.parse(data) as DescriptionCache;
    if (cache.version !== CACHE_VERSION) {
      return { version: CACHE_VERSION, entries: {} };
    }
    return cache;
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}

/**
 * Save the description cache to disk.
 */
async function saveCache(
  cachePath: string,
  cache: DescriptionCache
): Promise<void> {
  const dir = path.dirname(cachePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
}

/**
 * Generate an enhanced description for a tool.
 * This is called by the AI assistant when it wants to improve a tool description.
 */
export function generateRewritePrompt(tool: ToolDefinition): string {
  const params = Object.entries(tool.input_schema.properties || {})
    .map(([key, value]) => {
      const desc =
        typeof value === "object" && value !== null
          ? (value as { description?: string }).description || ""
          : "";
      return `  - ${key}: ${desc}`;
    })
    .join("\n");

  return `Rewrite this MCP tool description to be more searchable and descriptive.
Keep it concise (1-2 sentences) but include key action words and use cases.

Tool Name: ${tool.name}
Current Description: ${tool.description}
Parameters:
${params || "  (none)"}

Requirements:
1. Start with an action verb (e.g., "Navigate", "Click", "Create", "Search")
2. Include what the tool does and when to use it
3. Mention key parameters if relevant
4. Keep under 100 words

Respond with ONLY the new description, nothing else.`;
}

/**
 * Apply a rewritten description to a tool (creates a new tool object).
 */
export function applyRewrittenDescription(
  tool: ToolDefinition,
  newDescription: string
): ToolDefinition {
  return {
    ...tool,
    description: newDescription,
  };
}

/**
 * Tool Description Rewriter class.
 */
export class ToolDescriptionRewriter {
  private readonly options: RewriteOptions;
  private cache: DescriptionCache | null = null;

  constructor(options?: Partial<RewriteOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if rewriting is enabled.
   */
  isEnabled(): boolean {
    return this.options.enabled;
  }

  /**
   * Load the cache from disk.
   */
  async loadCache(): Promise<void> {
    if (!(this.options.cacheResults && this.options.cachePath)) {
      return;
    }
    this.cache = await loadCache(this.options.cachePath);
  }

  /**
   * Save the cache to disk.
   */
  async saveCache(): Promise<void> {
    if (!(this.options.cacheResults && this.options.cachePath && this.cache)) {
      return;
    }
    await saveCache(this.options.cachePath, this.cache);
  }

  /**
   * Get cached description for a tool if available.
   */
  getCachedDescription(tool: ToolDefinition): string | null {
    if (!this.cache) {
      return null;
    }

    const entry = this.cache.entries[tool.name];
    if (!entry) {
      return null;
    }

    // Check if the original description has changed
    const currentHash = hashString(tool.description);
    if (entry.originalHash !== currentHash) {
      return null;
    }

    return entry.rewrittenDescription;
  }

  /**
   * Cache a rewritten description.
   */
  cacheDescription(tool: ToolDefinition, newDescription: string): void {
    if (!this.cache) {
      this.cache = { version: CACHE_VERSION, entries: {} };
    }

    this.cache.entries[tool.name] = {
      originalHash: hashString(tool.description),
      rewrittenDescription: newDescription,
      timestamp: Date.now(),
    };
  }

  /**
   * Get tools that need rewriting (not in cache).
   */
  getToolsNeedingRewrite(tools: ToolDefinition[]): ToolDefinition[] {
    return tools.filter((tool) => {
      const cached = this.getCachedDescription(tool);
      return cached === null;
    });
  }

  /**
   * Apply cached descriptions to tools where available.
   */
  applyCache(tools: ToolDefinition[]): ToolDefinition[] {
    return tools.map((tool) => {
      const cached = this.getCachedDescription(tool);
      if (cached) {
        return applyRewrittenDescription(tool, cached);
      }
      return tool;
    });
  }

  /**
   * Get the prompt for rewriting a batch of tools.
   */
  getBatchRewritePrompt(tools: ToolDefinition[]): string {
    const toolPrompts = tools
      .map(
        (tool, i) =>
          `[Tool ${i + 1}]
Name: ${tool.name}
Description: ${tool.description}
Parameters: ${Object.keys(tool.input_schema.properties || {}).join(", ") || "none"}`
      )
      .join("\n\n");

    return `Rewrite these MCP tool descriptions to be more searchable.
For each tool, provide a concise 1-2 sentence description starting with an action verb.

${toolPrompts}

Respond in this exact format (one description per line, matching the tool order):
[1] New description for tool 1
[2] New description for tool 2
...`;
  }

  /**
   * Parse batch rewrite response.
   */
  parseBatchResponse(response: string): Map<number, string> {
    const results = new Map<number, string>();
    const lines = response.split("\n");

    for (const line of lines) {
      const match = line.match(/^\[(\d+)\]\s*(.+)$/);
      if (match) {
        const index = Number.parseInt(match[1], 10) - 1;
        const description = match[2].trim();
        if (description) {
          results.set(index, description);
        }
      }
    }

    return results;
  }
}

/**
 * Create a new rewriter instance.
 */
export function createRewriter(
  options?: Partial<RewriteOptions>
): ToolDescriptionRewriter {
  return new ToolDescriptionRewriter(options);
}

/**
 * Global rewriter instance.
 */
export const rewriter = new ToolDescriptionRewriter();
