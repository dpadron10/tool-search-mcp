/**
 * Unified Search Service
 *
 * Manages multiple search backends and provides a unified interface
 * for tool discovery using embedding, BM25, or regex search.
 */

import type {
  SearchEngine,
  SearchEngineConfig,
  SearchMethod,
  SearchRequest,
  SearchResponse,
  SearchResult,
  ToolDefinition,
} from "./types";

export type {
  SearchEngine,
  SearchEngineConfig,
  SearchMethod,
  SearchRequest,
  SearchResponse,
  SearchResult,
  ToolDefinition,
};

export { BM25SearchEngine, createBM25Engine } from "./bm25";
export { createEmbeddingEngine, EmbeddingSearchEngine } from "./embedding";

export { formatToolForEmbedding, getAvailableFormats } from "./formats";

export { createRegexEngine, RegexSearchEngine } from "./regex";

/**
 * Unified search service that supports multiple search backends.
 */
export class UnifiedSearchService {
  private readonly engines: Map<SearchMethod, SearchEngine> = new Map();
  private defaultMethod: SearchMethod = "embedding";
  private tools: ToolDefinition[] = [];

  /**
   * Register a search engine for a specific method.
   */
  registerEngine(engine: SearchEngine): void {
    this.engines.set(engine.method, engine);
  }

  /**
   * Set the default search method.
   */
  setDefaultMethod(method: SearchMethod): void {
    if (!this.engines.has(method)) {
      throw new Error(`Search method "${method}" is not registered`);
    }
    this.defaultMethod = method;
  }

  /**
   * Get available search methods.
   */
  getAvailableMethods(): SearchMethod[] {
    return Array.from(this.engines.keys());
  }

  /**
   * Initialize all registered engines with tools.
   */
  async initialize(
    tools: ToolDefinition[],
    config?: SearchEngineConfig
  ): Promise<void> {
    this.tools = tools;

    const initPromises = Array.from(this.engines.values()).map((engine) =>
      engine.initialize(tools, config)
    );

    await Promise.all(initPromises);
  }

  /**
   * Initialize a specific engine only.
   */
  async initializeEngine(
    method: SearchMethod,
    tools: ToolDefinition[],
    config?: SearchEngineConfig
  ): Promise<void> {
    const engine = this.engines.get(method);
    if (!engine) {
      throw new Error(`Search method "${method}" is not registered`);
    }
    this.tools = tools;
    await engine.initialize(tools, config);
  }

  /**
   * Search for tools using the specified or default method.
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    const method = request.method || this.defaultMethod;
    const topK = request.topK || 5;

    const engine = this.engines.get(method);
    if (!engine) {
      throw new Error(`Search method "${method}" is not registered`);
    }

    if (!engine.isReady()) {
      throw new Error(`Search engine "${method}" is not initialized`);
    }

    const startTime = Date.now();
    const results = await engine.search(request.query, topK);
    const took = Date.now() - startTime;

    return {
      results,
      method,
      took,
    };
  }

  /**
   * Search using a specific method (convenience method).
   */
  async searchWith(
    method: SearchMethod,
    query: string,
    topK = 5
  ): Promise<SearchResult[]> {
    const response = await this.search({ query, topK, method });
    return response.results;
  }

  /**
   * Reload all engines with new tools.
   */
  async reload(
    tools: ToolDefinition[],
    config?: SearchEngineConfig
  ): Promise<void> {
    this.tools = tools;

    const reloadPromises = Array.from(this.engines.values()).map((engine) =>
      engine.reload(tools, config)
    );

    await Promise.all(reloadPromises);
  }

  /**
   * Get the engine for a specific method.
   */
  getEngine(method: SearchMethod): SearchEngine | undefined {
    return this.engines.get(method);
  }

  /**
   * Get all loaded tools.
   */
  getAllTools(): ToolDefinition[] {
    return this.tools;
  }

  /**
   * Get count of loaded tools.
   */
  getToolsCount(): number {
    return this.tools.length;
  }

  /**
   * Get names of all loaded tools.
   */
  getToolNames(): string[] {
    return this.tools.map((t) => t.name);
  }

  /**
   * Check if any engine is ready.
   */
  isReady(): boolean {
    return Array.from(this.engines.values()).some((e) => e.isReady());
  }

  /**
   * Check if a specific engine is ready.
   */
  isEngineReady(method: SearchMethod): boolean {
    const engine = this.engines.get(method);
    return engine?.isReady() ?? false;
  }
}
