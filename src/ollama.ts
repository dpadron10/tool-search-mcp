import ollama from "ollama";

export interface OllamaConfig {
  host: string;
  model: string;
}

/**
 * Client for interacting with Ollama's embedding API.
 * Handles connection management and embedding generation.
 */
export class OllamaClient {
  private readonly config: OllamaConfig;

  /**
   * Creates a new OllamaClient instance.
   *
   * @param config - Optional configuration overrides for host and model
   */
  constructor(config?: Partial<OllamaConfig>) {
    this.config = {
      host: config?.host || process.env.OLLAMA_HOST || "http://localhost:11434",
      model:
        config?.model || process.env.OLLAMA_MODEL || "nomic-embed-text-v2-moe",
    };
  }

  /**
   * Checks if the Ollama server is reachable.
   *
   * @returns Promise resolving to true if connection successful, false otherwise
   */
  async checkConnection(): Promise<boolean> {
    try {
      await ollama.list();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generates a vector embedding for a single text string.
   *
   * @param text - The text to generate an embedding for
   * @returns Promise resolving to the embedding vector
   * @throws Error if embedding generation fails
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const response = await ollama.embed({
      model: this.config.model,
      input: text,
    });

    return response.embeddings[0];
  }

  /**
   * Generates vector embeddings for multiple text strings in a single request.
   *
   * @param texts - Array of texts to generate embeddings for
   * @returns Promise resolving to array of embedding vectors
   * @throws Error if embedding generation fails
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await ollama.embed({
      model: this.config.model,
      input: texts,
    });

    return response.embeddings;
  }

  /**
   * Returns the configured embedding model name.
   *
   * @returns The model name string
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Returns the configured Ollama server host URL.
   *
   * @returns The host URL string
   */
  getHost(): string {
    return this.config.host;
  }
}

export const ollamaClient = new OllamaClient();
