/**
 * Search Engine Types
 *
 * Unified interfaces for different search backends (embedding, BM25, regex).
 */

/**
 * Tool definition structure from MCP servers.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Search result with relevance score.
 */
export interface SearchResult {
  name: string;
  description: string;
  score: number;
}

/**
 * Available search methods.
 */
export type SearchMethod = "embedding" | "bm25" | "regex";

/**
 * Embedding text format strategies for tuning search quality.
 */
export type EmbeddingFormat =
  | "minimal" // just description
  | "standard" // name + description
  | "rich" // name + description + params (current default)
  | "verbose" // name + description + params + param descriptions
  | "structured"; // JSON-like structured format

/**
 * Configuration for search engines.
 */
export interface SearchEngineConfig {
  /** Embedding model to use (for embedding search) */
  model?: string;
  /** Embedding format strategy */
  format?: EmbeddingFormat;
  /** BM25 parameters */
  bm25?: {
    k1?: number;
    b?: number;
  };
}

/**
 * Unified search engine interface.
 * All search backends must implement this interface.
 */
export interface SearchEngine {
  /** Human-readable name of the search engine */
  readonly name: string;

  /** The search method type */
  readonly method: SearchMethod;

  /**
   * Initialize the search engine with tool definitions.
   * @param tools - Array of tool definitions to index
   * @param config - Optional configuration
   */
  initialize(
    tools: ToolDefinition[],
    config?: SearchEngineConfig
  ): Promise<void>;

  /**
   * Search for tools matching the query.
   * @param query - Search query text
   * @param topK - Maximum number of results to return
   * @returns Array of search results sorted by relevance
   */
  search(query: string, topK: number): Promise<SearchResult[]>;

  /**
   * Check if the engine is initialized and ready for search.
   */
  isReady(): boolean;

  /**
   * Get all indexed tools.
   */
  getAllTools(): ToolDefinition[];

  /**
   * Clear and reinitialize with new tools.
   */
  reload(tools: ToolDefinition[], config?: SearchEngineConfig): Promise<void>;
}

/**
 * Search request parameters.
 */
export interface SearchRequest {
  query: string;
  topK?: number;
  method?: SearchMethod;
}

/**
 * Search response with metadata.
 */
export interface SearchResponse {
  results: SearchResult[];
  method: SearchMethod;
  model?: string;
  took: number;
}
