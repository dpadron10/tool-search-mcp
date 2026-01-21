import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import micromatch from "micromatch";
import type { ToolDefinition } from "./search";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpToolDefinition extends ToolDefinition {
  sourceServer: string;
}

/**
 * Converts an MCP Tool object to a McpToolDefinition.
 *
 * @param tool - The MCP Tool object from the SDK
 * @param serverName - The name of the MCP server this tool comes from
 * @returns A standardized tool definition compatible with the embedding engine
 */
function mcpToolToDefinition(
  tool: Tool,
  serverName: string
): McpToolDefinition {
  return {
    name: tool.name,
    description: tool.description ?? "",
    input_schema: {
      type: "object",
      properties: tool.inputSchema.properties as Record<string, unknown>,
      required: tool.inputSchema.required as string[],
    },
    sourceServer: serverName,
  };
}

export interface ExcludedTool {
  name: string;
  server?: string;
}

export interface LoadMcpToolsOptions {
  config: McpConfig;
  exclude?: {
    tools?: string[];
    servers?: string[];
  };
}

/**
 * Connects to a single MCP server and retrieves all available tools.
 *
 * @param serverName - Unique identifier for the MCP server
 * @param config - Server configuration including command, args, and environment variables
 * @returns Promise resolving to an array of tool definitions from the server
 * @throws Error if connection fails or tool listing fails
 */
async function connectToServer(
  serverName: string,
  config: McpServerConfig
): Promise<McpToolDefinition[]> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: Object.fromEntries(
      Object.entries({ ...process.env, ...config.env })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, v as string])
    ),
  });

  const client = new Client({
    name: "tool-search-mcp",
    version: "1.0.0",
  });

  await client.connect(transport);

  try {
    const result = await client.listTools();
    return result.tools.map((tool) => mcpToolToDefinition(tool, serverName));
  } finally {
    await client.close();
  }
}

/**
 * Loads tools from all configured MCP servers with optional filtering.
 *
 * @param options - Configuration options including MCP config and exclusion rules
 * @param options.config - MCP server configurations mapping server names to configs
 * @param options.exclude - Optional filters to exclude specific tools or servers
 * @param options.exclude.tools - Glob patterns to exclude tool names
 * @param options.exclude.servers - Glob patterns to exclude server names
 * @returns Promise resolving to an array of loaded tool definitions
 */
export async function loadMcpTools(
  options: LoadMcpToolsOptions
): Promise<McpToolDefinition[]> {
  const { config, exclude } = options;
  const allTools: McpToolDefinition[] = [];

  // Check if server should be excluded
  const isServerExcluded = (serverName: string): boolean => {
    if (!exclude?.servers) {
      return false;
    }
    return micromatch.isMatch(serverName, exclude.servers);
  };

  // Check if tool should be excluded
  const isToolExcluded = (toolName: string): boolean => {
    if (!exclude?.tools) {
      return false;
    }
    return micromatch.isMatch(toolName, exclude.tools);
  };

  const serverEntries = Object.entries(config.mcpServers);

  console.log(`Connecting to ${serverEntries.length} MCP server(s)...`);

  const connections = serverEntries.map(async ([serverName, serverConfig]) => {
    if (isServerExcluded(serverName)) {
      console.log(`  Skipping excluded server: ${serverName}`);
      return;
    }

    try {
      console.log(`  Connecting to ${serverName}...`);
      const tools = await connectToServer(serverName, serverConfig);
      const filteredTools = tools.filter((tool) => !isToolExcluded(tool.name));

      console.log(
        `  ${serverName}: Loaded ${tools.length} tools, ` +
          `${filteredTools.length} after exclusions`
      );

      allTools.push(...filteredTools);
    } catch (error) {
      console.error(`  Failed to connect to ${serverName}:`, error);
    }
  });

  await Promise.all(connections);

  return allTools;
}

/**
 * Retrieves MCP configuration from the MCP_CONFIG environment variable.
 *
 * @returns The parsed MCP configuration object, or null if not configured
 * @throws Error if JSON parsing fails (caught internally, returns null)
 */
export function getDefaultMcpConfig(): McpConfig | null {
  const mcpConfigJson = process.env.MCP_CONFIG;
  if (!mcpConfigJson) {
    return null;
  }

  try {
    // TODO: Instead of `JSON.parse`, use `zod` to parse the MCP config
    return JSON.parse(mcpConfigJson) as McpConfig;
  } catch {
    console.error("Failed to parse MCP_CONFIG environment variable");
    return null;
  }
}
