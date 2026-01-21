import {
  getDefaultMcpConfig,
  loadMcpTools,
  type McpConfig,
  type McpToolDefinition,
} from "./mcp";
import type { ToolDefinition } from "./search";

export interface ToolFilterOptions {
  excludeTools?: string[];
  excludeServers?: string[];
}

/**
 * Retrieves custom tools from configured MCP servers.
 * Loads configuration from environment variable or MCP_CONFIG_PATH file.
 *
 * @param options - Filtering options for which tools/servers to include
 * @param options.excludeTools - Optional glob patterns to exclude specific tools
 * @param options.excludeServers - Optional glob patterns to exclude entire servers
 * @returns Promise resolving to array of tool definitions from all accessible MCP servers
 */
export async function getCustomTools(
  options: ToolFilterOptions = {}
): Promise<ToolDefinition[]> {
  // Check for MCP config from environment
  const mcpConfig = getDefaultMcpConfig();

  // Check if there's a config file we should load
  const configPath = process.env.MCP_CONFIG_PATH;
  let fileConfig: McpConfig | null = null;

  if (configPath) {
    try {
      const fs = await import("node:fs/promises");
      const configData = await fs.readFile(configPath, "utf-8");
      fileConfig = JSON.parse(configData) as McpConfig;
    } catch (error) {
      console.error(`Failed to read MCP config from ${configPath}:`, error);
    }
  }

  const config = fileConfig ?? mcpConfig;
  if (!config) {
    return [];
  }

  console.log(
    `Loading MCP tools from ${fileConfig ? "file" : "environment"}...`
  );

  const mcpTools = await loadMcpTools({
    config,
    exclude: {
      tools: options.excludeTools,
      servers: options.excludeServers,
    },
  });

  return mcpTools;
}

/**
 * Loads MCP tools from a specific configuration without fallback to environment.
 *
 * @param mcpConfig - Explicit MCP configuration object
 * @param options - Optional filtering options
 * @returns Promise resolving to array of tool definitions
 */
export function getMcpToolsOnly(
  mcpConfig: McpConfig,
  options: ToolFilterOptions = {}
): Promise<McpToolDefinition[]> {
  return loadMcpTools({
    config: mcpConfig,
    exclude: {
      tools: options.excludeTools,
      servers: options.excludeServers,
    },
  });
}

/**
 * Parses a JSON string into an McpConfig object.
 *
 * @param jsonString - JSON string representation of MCP configuration
 * @returns Parsed McpConfig object
 * @throws Error if JSON parsing fails
 */
export function createMcpConfigFromJson(jsonString: string): McpConfig {
  return JSON.parse(jsonString) as McpConfig;
}
