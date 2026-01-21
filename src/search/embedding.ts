/**
 * Embedding Search Engine
 *
 * Semantic search using vector embeddings from Ollama.
 * Supports configurable embedding formats and models.
 */

import ollama from "ollama";
import { formatToolForEmbedding } from "./formats";
import type {
  EmbeddingFormat,
  SearchEngine,
  SearchEngineConfig,
  SearchResult,
  ToolDefinition,
} from "./types";

/**
 * Indexed tool with its embedding vector.
 */
interface IndexedTool {
  tool: ToolDefinition;
  embedding: number[];
  formattedText: string;
}

/**
 * Embedding Search Engine implementation.
 */
export class EmbeddingSearchEngine implements SearchEngine {
  readonly name = "Embedding";
  readonly method = "embedding" as const;

  private indexedTools: IndexedTool[] = [];
  private tools: ToolDefinition[] = [];
  private initialized = false;
  private currentModel: string;
  private currentFormat: EmbeddingFormat;

  constructor(model?: string, format?: EmbeddingFormat) {
    this.currentModel =
      model || process.env.OLLAMA_MODEL || "nomic-embed-text-v2-moe";
    this.currentFormat = format || "rich";
  }

  /**
   * Get the current embedding model.
   */
  getModel(): string {
    return this.currentModel;
  }

  /**
   * Get the current embedding format.
   */
  getFormat(): EmbeddingFormat {
    return this.currentFormat;
  }

  /**
   * Generate embedding for a single text.
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await ollama.embed({
      model: this.currentModel,
      input: text,
    });
    return response.embeddings[0];
  }

  /**
   * Generate embeddings for multiple texts.
   */
  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await ollama.embed({
      model: this.currentModel,
      input: texts,
    });
    return response.embeddings;
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  async initialize(
    tools: ToolDefinition[],
    config?: SearchEngineConfig
  ): Promise<void> {
    this.tools = tools;

    // Update model and format if provided
    if (config?.model) {
      this.currentModel = config.model;
    }
    if (config?.format) {
      this.currentFormat = config.format;
    }

    console.log(
      `Generating embeddings for ${tools.length} tools using ${this.currentModel}...`
    );

    // Format all tools for embedding
    const formattedTexts = tools.map((tool) =>
      formatToolForEmbedding(tool, this.currentFormat)
    );

    // Generate embeddings in batch
    const embeddings = await this.generateEmbeddings(formattedTexts);

    // Index tools with their embeddings
    this.indexedTools = tools.map((tool, index) => ({
      tool,
      embedding: embeddings[index],
      formattedText: formattedTexts[index],
    }));

    this.initialized = true;
    console.log("Embedding engine initialized successfully");
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new Error(
        "Embedding engine not initialized. Call initialize() first."
      );
    }

    // Generate embedding for the query
    const queryEmbedding = await this.generateEmbedding(query);

    // Calculate similarity scores for all tools
    const results: SearchResult[] = this.indexedTools.map((indexed) => ({
      name: indexed.tool.name,
      description: indexed.tool.description,
      score: this.cosineSimilarity(queryEmbedding, indexed.embedding),
    }));

    // Sort by score descending and return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  isReady(): boolean {
    return this.initialized;
  }

  getAllTools(): ToolDefinition[] {
    return this.tools;
  }

  async reload(
    tools: ToolDefinition[],
    config?: SearchEngineConfig
  ): Promise<void> {
    this.indexedTools = [];
    this.initialized = false;
    await this.initialize(tools, config);
  }

  /**
   * Get the formatted text used for a specific tool.
   */
  getToolFormattedText(toolName: string): string | undefined {
    const indexed = this.indexedTools.find((t) => t.tool.name === toolName);
    return indexed?.formattedText;
  }
}

/**
 * Create a new Embedding search engine instance.
 */
export function createEmbeddingEngine(
  model?: string,
  format?: EmbeddingFormat
): EmbeddingSearchEngine {
  return new EmbeddingSearchEngine(model, format);
}

// Re-export types for convenience
export type { EmbeddingFormat } from "./types";
