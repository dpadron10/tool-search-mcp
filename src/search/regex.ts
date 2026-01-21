/**
 * Regex Search Engine
 *
 * Pattern-based search using regex matching on tool names and descriptions.
 * Provides fast, deterministic search without ML dependencies.
 *
 * Features:
 * - Fuzzy matching on tool names (e.g., "navigate" matches "browser_navigate")
 * - Word boundary matching for precise results
 * - Score based on match count and position
 */

import type {
  SearchEngine,
  SearchEngineConfig,
  SearchResult,
  ToolDefinition,
} from "./types";

/**
 * Indexed document for regex search.
 */
interface IndexedDocument {
  tool: ToolDefinition;
  searchText: string;
  nameParts: string[];
}

/**
 * Regex Search Engine implementation.
 */
export class RegexSearchEngine implements SearchEngine {
  readonly name = "Regex";
  readonly method = "regex" as const;

  private documents: IndexedDocument[] = [];
  private initialized = false;
  private tools: ToolDefinition[] = [];

  /**
   * Build searchable text from a tool definition.
   */
  private buildSearchText(tool: ToolDefinition): string {
    const parts = [
      tool.name,
      tool.name.replace(/_/g, " "),
      tool.description,
      ...Object.keys(tool.input_schema.properties || {}),
    ];

    // Add parameter descriptions
    const props = tool.input_schema.properties || {};
    for (const value of Object.values(props)) {
      if (
        typeof value === "object" &&
        value !== null &&
        "description" in value
      ) {
        parts.push(
          String((value as { description?: string }).description || "")
        );
      }
    }

    return parts.join(" ").toLowerCase();
  }

  /**
   * Extract searchable name parts from tool name.
   */
  private extractNameParts(name: string): string[] {
    return name
      .toLowerCase()
      .split(/_|-/)
      .filter((part) => part.length > 0);
  }

  /**
   * Escape special regex characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Calculate match score for a document.
   */
  private calculateScore(doc: IndexedDocument, query: string): number {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1);

    let score = 0;

    // Score for exact name match (highest priority)
    if (doc.tool.name.toLowerCase() === queryLower.replace(/\s+/g, "_")) {
      score += 100;
    }

    // Score for name parts matching
    for (const word of queryWords) {
      const escapedWord = this.escapeRegex(word);

      // Check if word appears in name parts
      for (const namePart of doc.nameParts) {
        if (namePart === word) {
          score += 20; // Exact name part match
        } else if (namePart.includes(word)) {
          score += 10; // Partial name part match
        } else if (word.includes(namePart)) {
          score += 5; // Query word contains name part
        }
      }

      // Check for word boundary matches in search text
      try {
        const wordBoundaryRegex = new RegExp(`\\b${escapedWord}\\b`, "gi");
        const matches = doc.searchText.match(wordBoundaryRegex);
        if (matches) {
          score += matches.length * 3;
        }
      } catch {
        // Invalid regex, skip
      }

      // Check for partial matches
      if (doc.searchText.includes(word)) {
        score += 1;
      }
    }

    // Bonus for description starting with query-related words
    const descLower = doc.tool.description.toLowerCase();
    for (const word of queryWords) {
      if (descLower.startsWith(word)) {
        score += 5;
      }
    }

    // Normalize by query length to avoid bias
    return score / Math.max(queryWords.length, 1);
  }

  async initialize(
    tools: ToolDefinition[],
    _config?: SearchEngineConfig
  ): Promise<void> {
    this.tools = tools;

    this.documents = tools.map((tool) => ({
      tool,
      searchText: this.buildSearchText(tool),
      nameParts: this.extractNameParts(tool.name),
    }));

    this.initialized = true;
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new Error("Regex engine not initialized. Call initialize() first.");
    }

    // Calculate scores for all documents
    const results: SearchResult[] = this.documents.map((doc) => ({
      name: doc.tool.name,
      description: doc.tool.description,
      score: this.calculateScore(doc, query),
    }));

    // Filter out zero scores and sort by score descending
    const filteredResults = results.filter((r) => r.score > 0);
    filteredResults.sort((a, b) => b.score - a.score);

    // If no matches, return top results by name similarity
    if (filteredResults.length === 0) {
      return results.slice(0, topK);
    }

    return filteredResults.slice(0, topK);
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
    this.initialized = false;
    await this.initialize(tools, config);
  }
}

/**
 * Create a new Regex search engine instance.
 */
export function createRegexEngine(): RegexSearchEngine {
  return new RegexSearchEngine();
}
