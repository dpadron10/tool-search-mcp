import "@dotenvx/dotenvx/config";

import { Elysia, t } from "elysia";
import { ollamaClient } from "./ollama";
import { generateRewritePrompt, rewriter } from "./rewriter";
import { createBM25Engine } from "./search/bm25";
import { createEmbeddingEngine } from "./search/embedding";
import { type ToolDefinition, UnifiedSearchService } from "./search/index";
import { createRegexEngine } from "./search/regex";
import { getCustomTools } from "./tools";

// Create and configure search service
const embeddingEngine = createEmbeddingEngine();
const bm25Engine = createBM25Engine();
const regexEngine = createRegexEngine();
const searchService = new UnifiedSearchService();

searchService.registerEngine(embeddingEngine);
searchService.registerEngine(bm25Engine);
searchService.registerEngine(regexEngine);
searchService.setDefaultMethod("embedding");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const app = new Elysia()
  .onError(({ error, code }) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error [${code}]:`, message);
    return { error: message };
  })
  .get("/health", async () => {
    const ollamaConnected = await ollamaClient.checkConnection();
    const toolsLoaded = searchService.getToolsCount();

    return {
      status: ollamaConnected ? "healthy" : "unhealthy",
      ollamaConnected,
      model: ollamaClient.getModel(),
      toolsLoaded,
    };
  })
  .post(
    "/search",
    async ({ body }) => {
      const { query, topK } = body;

      if (!query || typeof query !== "string") {
        throw new Error("Query is required and must be a string");
      }

      const response = await searchService.search({ query, topK });

      return {
        type: "tool_result",
        content: {
          type: "tool_search_result",
          tool_references: response.results.map((r) => ({
            type: "tool_reference",
            tool_name: r.name,
          })),
        },
        meta: {
          method: response.method,
          took: response.took,
          results: response.results,
        },
      };
    },
    {
      body: t.Object({
        query: t.String(),
        topK: t.Optional(t.Number()),
      }),
    }
  )
  .get("/tools", () => ({
    tools: searchService.getToolNames(),
    count: searchService.getToolsCount(),
  }))
  .post(
    "/reload",
    async ({ body }) => {
      const { excludeTools, excludeServers, mcpConfig } = body;

      let toolsToLoad: ToolDefinition[];
      if (mcpConfig && typeof mcpConfig === "object") {
        const customTools = await getCustomTools({
          excludeTools,
          excludeServers,
        });
        toolsToLoad = customTools;
      } else {
        toolsToLoad = await getCustomTools({
          excludeTools,
          excludeServers,
        });
      }

      await searchService.reload(toolsToLoad);

      return {
        success: true,
        toolsLoaded: searchService.getToolsCount(),
      };
    },
    {
      body: t.Object({
        excludeTools: t.Optional(t.Array(t.String())),
        excludeServers: t.Optional(t.Array(t.String())),
        mcpConfig: t.Optional(t.Any()),
      }),
    }
  )
  // MCP Tool: Rewrite tool descriptions for better search
  .post(
    "/rewrite-descriptions",
    async ({ body }) => {
      const { tools, forceRewrite } = body;

      if (!(rewriter.isEnabled() || forceRewrite)) {
        return {
          success: false,
          error:
            "Rewriting is disabled. Set DISABLE_REWRITE=false or pass forceRewrite=true",
          tools,
        };
      }

      // Load cache
      await rewriter.loadCache();

      // Find tools that need rewriting
      const needRewrite = forceRewrite
        ? tools
        : rewriter.getToolsNeedingRewrite(tools);

      // Generate prompts for each tool
      const prompts = needRewrite.map((tool) => ({
        toolName: tool.name,
        prompt: generateRewritePrompt(tool),
      }));

      // Apply cached descriptions to tools that don't need rewriting
      const toolsWithCache = forceRewrite ? tools : rewriter.applyCache(tools);

      return {
        success: true,
        toolsNeedingRewrite: needRewrite.length,
        totalTools: tools.length,
        prompts,
        tools: toolsWithCache,
        message:
          needRewrite.length > 0
            ? `${needRewrite.length} tools need rewriting. Use the prompts to generate new descriptions, then call /apply-rewritten-descriptions.`
            : "All tools have cached descriptions.",
      };
    },
    {
      body: t.Object({
        tools: t.Array(
          t.Object({
            name: t.String(),
            description: t.String(),
            input_schema: t.Object({
              type: t.Literal("object"),
              properties: t.Record(t.String(), t.Any()),
              required: t.Optional(t.Array(t.String())),
            }),
          })
        ),
        forceRewrite: t.Optional(t.Boolean()),
      }),
    }
  )
  // Apply rewritten descriptions and cache them
  .post(
    "/apply-rewritten-descriptions",
    async ({ body }) => {
      const { tools, rewrittenDescriptions } = body;

      const updatedTools: ToolDefinition[] = [];

      for (const tool of tools) {
        const newDesc = rewrittenDescriptions[tool.name];
        if (newDesc) {
          const updatedTool = { ...tool, description: newDesc };
          rewriter.cacheDescription(tool, newDesc);
          updatedTools.push(updatedTool);
        } else {
          updatedTools.push(tool);
        }
      }

      // Save cache
      await rewriter.saveCache();

      return {
        success: true,
        updatedCount: Object.keys(rewrittenDescriptions).length,
        tools: updatedTools,
      };
    },
    {
      body: t.Object({
        tools: t.Array(
          t.Object({
            name: t.String(),
            description: t.String(),
            input_schema: t.Object({
              type: t.Literal("object"),
              properties: t.Record(t.String(), t.Any()),
              required: t.Optional(t.Array(t.String())),
            }),
          })
        ),
        rewrittenDescriptions: t.Record(t.String(), t.String()),
      }),
    }
  )
  // Get available search methods
  .get("/search-methods", () => ({
    methods: searchService.getAvailableMethods(),
    defaultMethod: "embedding",
  }))
  // Search with specific method
  .post(
    "/search-with-method",
    async ({ body }) => {
      const { query, topK, method } = body;

      if (!searchService.isEngineReady(method)) {
        throw new Error(`Search method "${method}" is not initialized`);
      }

      const startTime = Date.now();
      const results = await searchService.searchWith(method, query, topK);
      const took = Date.now() - startTime;

      return {
        results,
        method,
        took,
      };
    },
    {
      body: t.Object({
        query: t.String(),
        topK: t.Optional(t.Number()),
        method: t.Union([
          t.Literal("embedding"),
          t.Literal("bm25"),
          t.Literal("regex"),
        ]),
      }),
    }
  );

// Initialize and start server
/**
 * Initializes all services and starts the HTTP server.
 * Sets up Ollama connection, loads tools, and begins listening for requests.
 *
 * @throws Error if initialization fails or required services are unavailable
 */
async function start() {
  try {
    console.log("Initializing Ollama client...");
    console.log(`  Host: ${ollamaClient.getHost()}`);
    console.log(`  Model: ${ollamaClient.getModel()}`);

    const connected = await ollamaClient.checkConnection();
    if (connected) {
      console.log("Connected to Ollama successfully");
    } else {
      console.warn(
        "Warning: Ollama is not running. Make sure Ollama is started with:"
      );
      console.warn("  ollama serve");
      console.warn("And the embedding model is pulled:");
      console.warn("  ollama pull nomic-embed-text");
      console.warn("");
    }

    console.log("Loading tools...");
    const customTools = await getCustomTools();

    // Initialize all search engines
    console.log("Initializing search engines...");
    await searchService.initialize(customTools);
    console.log(`Loaded ${searchService.getToolsCount()} tools`);
    console.log(
      `Available search methods: ${searchService.getAvailableMethods().join(", ")}`
    );

    // Load description rewriter cache
    if (rewriter.isEnabled()) {
      await rewriter.loadCache();
      console.log("Description rewriter: enabled (cache loaded)");
    } else {
      console.log("Description rewriter: disabled");
    }

    app.listen(PORT, () => {
      console.log(`\nServer running at http://${HOST}:${PORT}`);
      console.log("Endpoints:");
      console.log("  GET  /health                    - Health check");
      console.log(
        "  POST /search                    - Search tools (main endpoint)"
      );
      console.log("  GET  /tools                     - List available tools");
      console.log("  POST /reload                    - Reload tools");
      console.log(
        "  GET  /search-methods            - List available search methods"
      );
      console.log(
        "  POST /search-with-method        - Search with specific method"
      );
      console.log(
        "  POST /rewrite-descriptions      - Get rewrite prompts for tools"
      );
      console.log(
        "  POST /apply-rewritten-descriptions - Apply and cache rewritten descriptions"
      );
      console.log("");
      console.log("Environment configuration:");
      console.log(
        "  MCP_CONFIG          - JSON MCP config (server names → config)"
      );
      console.log("  MCP_CONFIG_PATH     - Path to MCP config JSON file");
      console.log(
        "  DISABLE_REWRITE     - Set to 'true' to disable description rewriting"
      );
      console.log("");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();

export { app };
