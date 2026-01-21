/**
 * Anthropic Models Fetcher
 *
 * Dynamically fetches current model information from Anthropic's documentation
 * with file-based caching to avoid hitting the docs site on every run.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview
 */

/**
 * Anthropic model information structure.
 */
export interface AnthropicModel {
  /** API ID for the model */
  id: string;
  /** Display name */
  name: string;
  /** Model description */
  description: string;
  /** Context window size in tokens */
  contextWindow: number;
  /** Max output tokens */
  maxOutput: number;
  /** Input price per million tokens */
  inputPrice: number;
  /** Output price per million tokens */
  outputPrice: number;
  /** Pricing tier description */
  pricing: string;
  /** Whether this is a legacy model */
  isLegacy: boolean;
  /** Snapshot date for version pinning */
  snapshotDate?: string;
}

/**
 * Cached models response structure.
 */
interface CachedModels {
  /** When the data was fetched */
  fetchedAt: string;
  /** Source URL */
  source: string;
  /** Cache version for invalidation */
  version: string;
  /** List of current models */
  models: AnthropicModel[];
}

/**
 * Cache configuration.
 */
const CACHE_CONFIG = {
  /** Cache file path */
  filePath: ".cache/anthropic-models.json",
  /** Cache TTL in milliseconds (24 hours) */
  ttlMs: 24 * 60 * 60 * 1000,
  /** Cache version for schema changes */
  version: "1.0.0",
  /** Source URL for model data */
  sourceUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
};

/**
 * Default models as fallback when fetching fails.
 * These are current models as of January 2026.
 */
const DEFAULT_MODELS: AnthropicModel[] = [
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    description: "Our smart model for complex agents and coding",
    contextWindow: 200_000,
    maxOutput: 64_000,
    inputPrice: 3,
    outputPrice: 15,
    pricing: "$3 input / $15 output per MTok",
    isLegacy: false,
    snapshotDate: "20250929",
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    description: "Our fastest model with near-frontier intelligence",
    contextWindow: 200_000,
    maxOutput: 64_000,
    inputPrice: 1,
    outputPrice: 5,
    pricing: "$1 input / $5 output per MTok",
    isLegacy: false,
    snapshotDate: "20251001",
  },
  {
    id: "claude-opus-4-5-20251101",
    name: "Claude Opus 4.5",
    description:
      "Premium model combining maximum intelligence with practical performance",
    contextWindow: 200_000,
    maxOutput: 64_000,
    inputPrice: 5,
    outputPrice: 25,
    pricing: "$5 input / $25 output per MTok",
    isLegacy: false,
    snapshotDate: "20251101",
  },
  // Legacy models for backward compatibility
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    description: "Previous generation model (deprecated)",
    contextWindow: 200_000,
    maxOutput: 64_000,
    inputPrice: 3,
    outputPrice: 15,
    pricing: "$3 input / $15 output per MTok",
    isLegacy: true,
    snapshotDate: "20250514",
  },
  {
    id: "claude-opus-4-20250514",
    name: "Claude Opus 4",
    description: "Previous generation model (deprecated)",
    contextWindow: 200_000,
    maxOutput: 32_000,
    inputPrice: 15,
    outputPrice: 75,
    pricing: "$15 input / $75 output per MTok",
    isLegacy: true,
    snapshotDate: "20250514",
  },
  {
    id: "claude-haiku-3-20250514",
    name: "Claude Haiku 3",
    description: "Previous generation fast model (deprecated)",
    contextWindow: 200_000,
    maxOutput: 4000,
    inputPrice: 0.25,
    outputPrice: 1.25,
    pricing: "$0.25 input / $1.25 output per MTok",
    isLegacy: true,
    snapshotDate: "20250514",
  },
];

/**
 * Ensures cache directory exists.
 */
async function ensureCacheDir(): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const cacheDir = path.dirname(CACHE_CONFIG.filePath);
  try {
    await fs.mkdir(cacheDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Reads cached models from file.
 */
async function readCache(): Promise<CachedModels | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  try {
    const cachePath = path.resolve(process.cwd(), CACHE_CONFIG.filePath);
    const content = await fs.readFile(cachePath, "utf-8");
    const cached = JSON.parse(content) as CachedModels;

    // Check if cache is expired
    const fetchedAt = new Date(cached.fetchedAt);
    const now = new Date();
    const ageMs = now.getTime() - fetchedAt.getTime();

    if (ageMs > CACHE_CONFIG.ttlMs) {
      console.log(
        `  Cache expired (${Math.round(ageMs / 3_600_000)}h old), refetching...`
      );
      return null;
    }

    // Check cache version
    if (cached.version !== CACHE_CONFIG.version) {
      console.log(
        `  Cache version mismatch (${cached.version} vs ${CACHE_CONFIG.version}), refetching...`
      );
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

/**
 * Writes models to cache file.
 */
async function writeCache(models: AnthropicModel[]): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  await ensureCacheDir();

  const cachePath = path.resolve(process.cwd(), CACHE_CONFIG.filePath);
  const cacheData: CachedModels = {
    fetchedAt: new Date().toISOString(),
    source: CACHE_CONFIG.sourceUrl,
    version: CACHE_CONFIG.version,
    models,
  };

  await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2), "utf-8");
}

/**
 * Fetches model data from Anthropic documentation.
 * Parses the models overview page to extract current model information.
 *
 * Note: This implementation provides a foundation for HTML parsing.
 * The actual parsing would need to be adapted based on the page structure.
 */
async function fetchModelsFromDocs(): Promise<AnthropicModel[]> {
  console.log(`  Fetching from ${CACHE_CONFIG.sourceUrl}...`);

  try {
    const response = await fetch(CACHE_CONFIG.sourceUrl, {
      headers: {
        "User-Agent": "Tool-Search-MCP-Benchmark/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Parse model data from HTML
    // The docs page has a table with model comparison
    // This is a placeholder for actual HTML parsing logic
    // In production, you would parse the model table from the docs page

    // For now, we return empty and use defaults
    // The fetch still validates the endpoint is accessible
    console.log(`  Fetched ${html.length} bytes from documentation`);
    console.log("  Using default models (HTML parsing not implemented)");

    return [];
  } catch (error) {
    console.error(`  Failed to fetch from docs: ${error}`);
    throw error;
  }
}

/**
 * Gets current Anthropic models with caching.
 * Falls back to default models if fetch fails.
 *
 * @param forceRefresh - Force cache refresh even if not expired
 * @returns Array of current Anthropic models
 */
export async function getAnthropicModels(
  forceRefresh = false
): Promise<AnthropicModel[]> {
  // Try cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await readCache();
    if (cached) {
      console.log(`  Using cached models (fetched: ${cached.fetchedAt})`);
      return cached.models;
    }
  }

  // Try to fetch fresh data
  try {
    const models = await fetchModelsFromDocs();
    // Always cache the models (either fetched or defaults)
    const modelsToCache = models.length > 0 ? models : DEFAULT_MODELS;
    await writeCache(modelsToCache);
    console.log(`  Cached ${modelsToCache.length} models`);
    return modelsToCache;
  } catch {
    // Fall back to defaults and cache them
    await writeCache(DEFAULT_MODELS);
    console.log("  Cached default models (fetch failed)");
    return DEFAULT_MODELS;
  }
}

/**
 * Gets only current (non-legacy) models.
 */
export async function getCurrentModels(): Promise<AnthropicModel[]> {
  const models = await getAnthropicModels();
  return models.filter((m) => !m.isLegacy);
}

/**
 * Gets a specific model by ID.
 */
export async function getModelById(
  modelId: string
): Promise<AnthropicModel | null> {
  const models = await getAnthropicModels();
  return models.find((m) => m.id === modelId) ?? null;
}

/**
 * Gets the recommended default model for token counting.
 * Uses the latest Sonnet model as the default.
 */
export async function getDefaultModel(): Promise<AnthropicModel> {
  const currentModels = await getCurrentModels();
  const sonnetModel = currentModels.find((m) => m.id.includes("sonnet"));

  if (sonnetModel) {
    return sonnetModel;
  }

  // Fallback to first current model or first default
  return currentModels[0] ?? DEFAULT_MODELS[0];
}

/**
 * Gets model token limit.
 */
export async function getModelTokenLimit(modelId: string): Promise<number> {
  const model = await getModelById(modelId);
  return model?.contextWindow ?? 200_000;
}

/**
 * Gets model pricing.
 */
export async function getModelPricing(
  modelId: string
): Promise<{ input: number; output: number } | null> {
  const model = await getModelById(modelId);
  if (!model) {
    return null;
  }

  return {
    input: model.inputPrice,
    output: model.outputPrice,
  };
}

/**
 * Prints a formatted table of available models.
 */
export async function printModelsTable(): Promise<void> {
  const models = await getAnthropicModels();

  console.log("\n📋 Available Anthropic Models:");
  console.log("=".repeat(80));

  // Sort: current models first, then by price
  const sorted = [...models].sort((a, b) => {
    if (a.isLegacy !== b.isLegacy) {
      return a.isLegacy ? 1 : -1;
    }
    return a.inputPrice - b.inputPrice;
  });

  for (const model of sorted) {
    const status = model.isLegacy ? " (Legacy)" : " ✓";
    const snapshot = model.snapshotDate ? ` [${model.snapshotDate}]` : "";
    console.log(
      `  ${model.name.padEnd(22)}${status}${snapshot.padEnd(14)} ${model.id}`
    );
    console.log(`    ${model.description}`);
    console.log(
      `    Context: ${(model.contextWindow / 1000).toFixed(0)}K | Output: ${(model.maxOutput / 1000).toFixed(0)}K | ${model.pricing}`
    );
    console.log();
  }

  console.log("=".repeat(80));
  const currentCount = models.filter((m) => !m.isLegacy).length;
  console.log(
    `  Total: ${models.length} models (${currentCount} current, ${models.length - currentCount} legacy)`
  );
}

/**
 * Clears the model cache.
 */
export async function clearCache(): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  try {
    const cachePath = path.resolve(process.cwd(), CACHE_CONFIG.filePath);
    await fs.unlink(cachePath);
    console.log("Cache cleared");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    console.log("No cache file to clear");
  }
}

/**
 * Checks if cache needs refresh.
 */
export async function isCacheStale(): Promise<boolean> {
  const cached = await readCache();
  return cached === null;
}

/**
 * Gets all model IDs for token limit lookups.
 */
export async function getAllModelIds(): Promise<string[]> {
  const models = await getAnthropicModels();
  return models.map((m) => m.id);
}

/**
 * Builds token limits object from fetched models.
 */
export async function getModelTokenLimits(): Promise<Record<string, number>> {
  const models = await getAnthropicModels();
  const limits: Record<string, number> = {};

  for (const model of models) {
    limits[model.id] = model.contextWindow;
  }

  // Add default fallback
  limits.default = 200_000;

  return limits;
}

/**
 * Builds pricing object from fetched models.
 */
export async function getPricingRates(): Promise<
  Record<string, { input: number; output: number }>
> {
  const models = await getAnthropicModels();
  const rates: Record<string, { input: number; output: number }> = {};

  for (const model of models) {
    rates[model.id] = {
      input: model.inputPrice,
      output: model.outputPrice,
    };
  }

  return rates;
}
