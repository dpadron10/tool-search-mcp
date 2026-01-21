/**
 * Embedding Model Management
 *
 * Handles checking, pulling, and benchmarking of Ollama embedding models.
 */

import ollama from "ollama";

/**
 * List of embedding models to benchmark.
 * These are commonly used embedding models available in Ollama.
 */
export const EMBEDDING_MODELS = [
  "nomic-embed-text",
  "mxbai-embed-large",
  "bge-m3",
  "all-minilm",
  "snowflake-arctic-embed",
  "embeddinggemma",
  "paraphrase-multilingual",
  "qwen3-embedding",
  "snowflake-arctic-embed2",
  "bge-large",
  "granite-embedding",
  "nomic-embed-text-v2-moe",
] as const;

export type EmbeddingModel = (typeof EMBEDDING_MODELS)[number];

/**
 * Model availability status.
 */
export interface ModelStatus {
  name: string;
  available: boolean;
  size?: string;
  pulledAt?: string;
  error?: string;
}

/**
 * List all locally available Ollama models.
 */
export async function listLocalModels(): Promise<string[]> {
  try {
    const response = await ollama.list();
    return response.models.map((m) => m.name.split(":")[0]);
  } catch (error) {
    console.error("Failed to list Ollama models:", error);
    return [];
  }
}

/**
 * Check if a specific model is available locally.
 */
export async function isModelAvailable(modelName: string): Promise<boolean> {
  try {
    const response = await ollama.list();
    return response.models.some(
      (m) =>
        m.name === modelName ||
        m.name.startsWith(`${modelName}:`) ||
        m.name === `${modelName}:latest`
    );
  } catch {
    return false;
  }
}

/**
 * Get detailed status for a model.
 */
export async function getModelStatus(modelName: string): Promise<ModelStatus> {
  try {
    const response = await ollama.list();
    const model = response.models.find(
      (m) =>
        m.name === modelName ||
        m.name.startsWith(`${modelName}:`) ||
        m.name === `${modelName}:latest`
    );

    if (model) {
      return {
        name: modelName,
        available: true,
        size: formatBytes(model.size),
        pulledAt:
          model.modified_at instanceof Date
            ? model.modified_at.toISOString()
            : String(model.modified_at),
      };
    }

    return {
      name: modelName,
      available: false,
    };
  } catch (error) {
    return {
      name: modelName,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Pull a model from Ollama registry.
 */
export async function pullModel(
  modelName: string,
  onProgress?: (progress: number) => void
): Promise<boolean> {
  try {
    console.log(`Pulling model: ${modelName}...`);

    const response = await ollama.pull({
      model: modelName,
      stream: true,
    });

    let lastProgress = 0;
    for await (const part of response) {
      if (part.total && part.completed) {
        const progress = Math.round((part.completed / part.total) * 100);
        if (progress !== lastProgress) {
          lastProgress = progress;
          onProgress?.(progress);
          process.stdout.write(`\r  Progress: ${progress}%`);
        }
      }
    }

    console.log(`\n  Model ${modelName} pulled successfully`);
    return true;
  } catch (error) {
    console.error(`\n  Failed to pull ${modelName}:`, error);
    return false;
  }
}

/**
 * Ensure a model is available, pulling it if necessary.
 */
export async function ensureModelAvailable(
  modelName: string
): Promise<boolean> {
  const available = await isModelAvailable(modelName);
  if (available) {
    return true;
  }

  console.log(`Model ${modelName} not found locally. Attempting to pull...`);
  return await pullModel(modelName);
}

/**
 * Get status of all benchmark models.
 */
export async function getAllModelStatuses(): Promise<ModelStatus[]> {
  const statuses = await Promise.all(
    EMBEDDING_MODELS.map((model) => getModelStatus(model))
  );
  return statuses;
}

/**
 * Get available benchmark models (already pulled).
 */
export async function getAvailableModels(): Promise<string[]> {
  const statuses = await getAllModelStatuses();
  return statuses.filter((s) => s.available).map((s) => s.name);
}

/**
 * Pull all missing benchmark models.
 */
export async function pullMissingModels(
  onModelProgress?: (
    model: string,
    status: "pulling" | "done" | "error"
  ) => void
): Promise<{ pulled: string[]; failed: string[] }> {
  const statuses = await getAllModelStatuses();
  const missing = statuses.filter((s) => !s.available).map((s) => s.name);

  const pulled: string[] = [];
  const failed: string[] = [];

  for (const model of missing) {
    onModelProgress?.(model, "pulling");
    const success = await pullModel(model);
    if (success) {
      pulled.push(model);
      onModelProgress?.(model, "done");
    } else {
      failed.push(model);
      onModelProgress?.(model, "error");
    }
  }

  return { pulled, failed };
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

/**
 * Print model status table.
 */
export function printModelStatusTable(statuses: ModelStatus[]): void {
  console.log("\nEmbedding Models Status:");
  console.log("=".repeat(60));

  for (const status of statuses) {
    const icon = status.available ? "✓" : "✗";
    const size = status.size || "not pulled";
    console.log(`  ${icon} ${status.name.padEnd(30)} ${size}`);
  }

  console.log("=".repeat(60));
  const available = statuses.filter((s) => s.available).length;
  console.log(`  ${available}/${statuses.length} models available`);
}
