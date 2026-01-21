/**
 * BM25 Search Engine
 *
 * Implements the BM25 (Best Matching 25) ranking algorithm for tool search.
 * BM25 is a bag-of-words retrieval function that ranks documents based on
 * query term frequency and inverse document frequency.
 *
 * Reference: https://en.wikipedia.org/wiki/Okapi_BM25
 */

import type {
  SearchEngine,
  SearchEngineConfig,
  SearchResult,
  ToolDefinition,
} from "./types";

/**
 * BM25 algorithm parameters.
 */
interface BM25Params {
  /** Term frequency saturation parameter (default: 1.5) */
  k1: number;
  /** Length normalization parameter (default: 0.75) */
  b: number;
}

/**
 * Indexed document for BM25 search.
 */
interface IndexedDocument {
  tool: ToolDefinition;
  tokens: string[];
  termFrequencies: Map<string, number>;
  length: number;
}

/**
 * BM25 Search Engine implementation.
 */
export class BM25SearchEngine implements SearchEngine {
  readonly name = "BM25";
  readonly method = "bm25" as const;

  private params: BM25Params = { k1: 1.5, b: 0.75 };
  private documents: IndexedDocument[] = [];
  private idf: Map<string, number> = new Map();
  private avgDocLength = 0;
  private initialized = false;
  private tools: ToolDefinition[] = [];

  /**
   * Tokenize text into searchable terms.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[_-]/g, " ") // Convert underscores/hyphens to spaces
      .replace(/[^\w\s]/g, " ") // Remove punctuation
      .split(/\s+/)
      .filter((token) => token.length > 1); // Filter single chars
  }

  /**
   * Build searchable text from a tool definition.
   */
  private buildDocumentText(tool: ToolDefinition): string {
    const parts = [
      tool.name.replace(/_/g, " "),
      tool.name,
      tool.description,
      ...Object.keys(tool.input_schema.properties || {}),
    ];

    // Add parameter descriptions if available
    const props = tool.input_schema.properties || {};
    for (const [key, value] of Object.entries(props)) {
      if (
        typeof value === "object" &&
        value !== null &&
        "description" in value
      ) {
        parts.push(
          String((value as { description?: string }).description || "")
        );
      }
      parts.push(key);
    }

    return parts.join(" ");
  }

  /**
   * Calculate term frequency for a document.
   */
  private calculateTermFrequencies(tokens: string[]): Map<string, number> {
    const frequencies = new Map<string, number>();
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }
    return frequencies;
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for all terms.
   */
  private calculateIDF(): void {
    const docCount = this.documents.length;
    const termDocCounts = new Map<string, number>();

    // Count documents containing each term
    for (const doc of this.documents) {
      const uniqueTerms = new Set(doc.tokens);
      for (const term of uniqueTerms) {
        termDocCounts.set(term, (termDocCounts.get(term) || 0) + 1);
      }
    }

    // Calculate IDF for each term
    // IDF = ln((N - n + 0.5) / (n + 0.5) + 1)
    for (const [term, docFreq] of termDocCounts) {
      const idf = Math.log((docCount - docFreq + 0.5) / (docFreq + 0.5) + 1);
      this.idf.set(term, idf);
    }
  }

  /**
   * Calculate BM25 score for a document given a query.
   */
  private calculateScore(doc: IndexedDocument, queryTokens: string[]): number {
    let score = 0;
    const { k1, b } = this.params;

    for (const term of queryTokens) {
      const tf = doc.termFrequencies.get(term) || 0;
      if (tf === 0) continue;

      const idf = this.idf.get(term) || 0;

      // BM25 formula
      // score += IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLength / avgDocLength))
      const numerator = tf * (k1 + 1);
      const denominator =
        tf + k1 * (1 - b + (b * doc.length) / this.avgDocLength);

      score += idf * (numerator / denominator);
    }

    return score;
  }

  async initialize(
    tools: ToolDefinition[],
    config?: SearchEngineConfig
  ): Promise<void> {
    this.tools = tools;

    // Update parameters if provided
    if (config?.bm25) {
      this.params = { ...this.params, ...config.bm25 };
    }

    // Index all documents
    this.documents = tools.map((tool) => {
      const text = this.buildDocumentText(tool);
      const tokens = this.tokenize(text);
      const termFrequencies = this.calculateTermFrequencies(tokens);

      return {
        tool,
        tokens,
        termFrequencies,
        length: tokens.length,
      };
    });

    // Calculate average document length
    const totalLength = this.documents.reduce(
      (sum, doc) => sum + doc.length,
      0
    );
    this.avgDocLength = totalLength / Math.max(this.documents.length, 1);

    // Calculate IDF for all terms
    this.calculateIDF();

    this.initialized = true;
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new Error("BM25 engine not initialized. Call initialize() first.");
    }

    const queryTokens = this.tokenize(query);

    // Calculate scores for all documents
    const results: SearchResult[] = this.documents.map((doc) => ({
      name: doc.tool.name,
      description: doc.tool.description,
      score: this.calculateScore(doc, queryTokens),
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
    this.documents = [];
    this.idf.clear();
    this.initialized = false;
    await this.initialize(tools, config);
  }
}

/**
 * Create a new BM25 search engine instance.
 */
export function createBM25Engine(): BM25SearchEngine {
  return new BM25SearchEngine();
}
