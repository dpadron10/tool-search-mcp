/**
 * Embeddings Module Re-export
 *
 * This file re-exports from the search directory for backwards compatibility.
 * New code should import directly from "./search".
 *
 * @deprecated Import from "./search" instead.
 */

export {
  createEmbeddingEngine,
  EmbeddingSearchEngine,
  type SearchResult,
  type ToolDefinition,
} from "./search";

// Create a legacy embeddingEngine instance for backwards compatibility
import { createEmbeddingEngine } from "./search";
export const embeddingEngine = createEmbeddingEngine();
