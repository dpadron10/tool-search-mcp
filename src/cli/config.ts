#!/usr/bin/env bun
/**
 * Config Migration CLI
 *
 * Converts between Claude Code config (~/.claude.json) and
 * Tool Search MCP config (~/.tool-search-mcp.jsonc).
 *
 * Usage:
 *   bun run config migrate        # Migrate from claude.json to tool-search-mcp.jsonc
 *   bun run config restore        # Restore from tool-search-mcp.jsonc to claude.json
 *   bun run config status         # Show current config status
 */

import { z } from "zod";

// ============================================
// Config Schemas (Zod for runtime safety)
// ============================================

/**
 * MCP Server configuration schema.
 */
const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

/**
 * Tool search method types.
 */
const ToolSearchType = z.enum([
  "tool_search_tool_regex_20251119",
  "tool_search_tool_regex",
  "tool_search_tool_bm25_20251119",
  "tool_search_tool_bm25",
  "tool_search_tool_embedding",
]);

/**
 * MCP toolset configuration schema.
 */
const McpToolsetConfigSchema = z.object({
  type: z.literal("mcp_toolset"),
  mcp_server_name: z.string(),
  default_config: z
    .object({
      defer_loading: z.boolean().optional(),
    })
    .optional(),
  configs: z
    .record(z.string(), z.object({ defer_loading: z.boolean().optional() }))
    .optional(),
});

/**
 * Tool search tool configuration schema.
 */
const ToolSearchToolConfigSchema = z.object({
  type: ToolSearchType,
  name: z.string(),
});

/**
 * Combined tool config schema.
 */
const ToolConfigSchema = z.union([
  McpToolsetConfigSchema,
  ToolSearchToolConfigSchema,
]);

/**
 * Tool Search MCP config schema.
 */
const ToolSearchMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerConfigSchema),
  tools: z.array(ToolConfigSchema).optional(),
});

/**
 * Claude Code config schema (partial - only what we need).
 */
const ClaudeConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
  tools: z.array(z.unknown()).optional(),
});

// Type exports
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type ToolSearchMcpConfig = z.infer<typeof ToolSearchMcpConfigSchema>;
export type ClaudeConfig = z.infer<typeof ClaudeConfigSchema>;

// ============================================
// Platform-specific paths
// ============================================

/**
 * Get Claude config path for current platform.
 */
function getClaudeConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || "";
    return `${appData}\\Claude\\claude.json`;
  }

  return `${home}/.claude.json`;
}

/**
 * Get Tool Search MCP config path for current platform.
 */
function getToolSearchConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || "";
    return `${appData}\\Claude\\tool-search-mcp.jsonc`;
  }

  return `${home}/.tool-search-mcp.jsonc`;
}

// ============================================
// JSONC Parser
// ============================================

/**
 * Strip JSONC comments safely (handles strings containing // or /*)
 */
function stripJsoncComments(content: string): string {
  let result = "";
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (!(inSingleLineComment || inMultiLineComment)) {
      if (char === '"' && content[i - 1] !== "\\") {
        inString = !inString;
        result += char;
        i++;
        continue;
      }

      if (inString) {
        result += char;
        i++;
        continue;
      }

      if (char === "/" && nextChar === "/") {
        inSingleLineComment = true;
        i += 2;
        continue;
      }

      if (char === "/" && nextChar === "*") {
        inMultiLineComment = true;
        i += 2;
        continue;
      }

      result += char;
      i++;
      continue;
    }

    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        result += char;
      }
      i++;
      continue;
    }

    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      i++;
    }
  }

  return result;
}

/**
 * Parse JSONC content.
 */
function parseJsonc<T>(content: string): T {
  const stripped = stripJsoncComments(content);
  return JSON.parse(stripped) as T;
}

// ============================================
// Config Operations
// ============================================

/**
 * Read Claude config.
 */
async function readClaudeConfig(): Promise<ClaudeConfig | null> {
  const fs = await import("node:fs/promises");
  const path = getClaudeConfigPath();

  try {
    const content = await fs.readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    return ClaudeConfigSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Read Tool Search MCP config.
 */
async function readToolSearchConfig(): Promise<ToolSearchMcpConfig | null> {
  const fs = await import("node:fs/promises");
  const path = getToolSearchConfigPath();

  try {
    const content = await fs.readFile(path, "utf-8");
    const parsed = parseJsonc<unknown>(content);
    return ToolSearchMcpConfigSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Write Tool Search MCP config with comments.
 */
async function writeToolSearchConfig(
  config: ToolSearchMcpConfig
): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = getToolSearchConfigPath();

  const content = `{
  // Tool Search MCP Configuration
  // Generated from ~/.claude.json
  //
  // Supported tool search types:
  //   - tool_search_tool_regex_20251119 / tool_search_tool_regex
  //   - tool_search_tool_bm25_20251119 / tool_search_tool_bm25
  //   - tool_search_tool_embedding
  //
  // MCP Server definitions
  "mcpServers": ${JSON.stringify(config.mcpServers, null, 4).split("\n").join("\n  ")},

  // Tools configuration
  // Each MCP server can be loaded with defer_loading for lazy loading
  "tools": ${JSON.stringify(config.tools, null, 4).split("\n").join("\n  ")}
}
`;

  await fs.writeFile(path, content, "utf-8");
}

/**
 * Backup a file before modifying.
 */
async function backupFile(path: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const backupPath = `${path}.backup.${Date.now()}`;

  try {
    await fs.copyFile(path, backupPath);
    return backupPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

/**
 * Update Claude config to use Tool Search MCP.
 */
function updateClaudeConfigForToolSearch(
  claudeConfig: ClaudeConfig,
  searchMethod: "regex" | "bm25" | "embedding" = "regex"
): ClaudeConfig {
  const toolSearchType =
    searchMethod === "regex"
      ? "tool_search_tool_regex_20251119"
      : searchMethod === "bm25"
        ? "tool_search_tool_bm25_20251119"
        : "tool_search_tool_embedding";

  // Create tools array with tool search + deferred MCP toolsets
  const tools: z.infer<typeof ToolConfigSchema>[] = [
    {
      type: toolSearchType as z.infer<typeof ToolSearchType>,
      name: `tool_search_tool_${searchMethod}`,
    },
  ];

  // Add each MCP server as a deferred toolset
  for (const serverName of Object.keys(claudeConfig.mcpServers || {})) {
    tools.push({
      type: "mcp_toolset",
      mcp_server_name: serverName,
      default_config: {
        defer_loading: true,
      },
    });
  }

  return {
    ...claudeConfig,
    tools,
  };
}

// ============================================
// CLI Commands
// ============================================

/**
 * Migrate from Claude config to Tool Search MCP config.
 */
async function migrate(
  searchMethod: "regex" | "bm25" | "embedding" = "regex"
): Promise<void> {
  const fs = await import("node:fs/promises");

  console.log("🔄 Migrating to Tool Search MCP...\n");

  // Read Claude config
  const claudeConfig = await readClaudeConfig();
  if (!claudeConfig?.mcpServers) {
    console.error("❌ No Claude config found at", getClaudeConfigPath());
    process.exit(1);
  }

  console.log(
    `📋 Found ${Object.keys(claudeConfig.mcpServers).length} MCP servers:`
  );
  for (const name of Object.keys(claudeConfig.mcpServers)) {
    console.log(`   • ${name}`);
  }

  // Create Tool Search MCP config
  const toolSearchConfig: ToolSearchMcpConfig = {
    mcpServers: claudeConfig.mcpServers,
    tools: [
      {
        type:
          searchMethod === "regex"
            ? "tool_search_tool_regex_20251119"
            : searchMethod === "bm25"
              ? "tool_search_tool_bm25_20251119"
              : "tool_search_tool_embedding",
        name: `tool_search_tool_${searchMethod}`,
      },
      ...Object.keys(claudeConfig.mcpServers).map((name) => ({
        type: "mcp_toolset" as const,
        mcp_server_name: name,
        default_config: {
          defer_loading: true,
        },
      })),
    ],
  };

  // Backup existing config
  const backupPath = await backupFile(getToolSearchConfigPath());
  if (backupPath) {
    console.log(`\n💾 Backed up existing config to: ${backupPath}`);
  }

  // Write new config
  await writeToolSearchConfig(toolSearchConfig);
  console.log(
    `\n✅ Created Tool Search MCP config at: ${getToolSearchConfigPath()}`
  );

  // Backup and update Claude config
  const claudeBackupPath = await backupFile(getClaudeConfigPath());
  if (claudeBackupPath) {
    console.log(`💾 Backed up Claude config to: ${claudeBackupPath}`);
  }

  const updatedClaudeConfig = await updateClaudeConfigForToolSearch(
    claudeConfig,
    searchMethod
  );

  // Read full Claude config (preserve other fields)
  const fullClaudeContent = await fs.readFile(getClaudeConfigPath(), "utf-8");
  const fullClaudeConfig = JSON.parse(fullClaudeContent);

  // Update only the tools array
  fullClaudeConfig.tools = updatedClaudeConfig.tools;

  await fs.writeFile(
    getClaudeConfigPath(),
    JSON.stringify(fullClaudeConfig, null, 2),
    "utf-8"
  );

  console.log(
    `✅ Updated Claude config with Tool Search (${searchMethod} method)`
  );
  console.log("\n🎉 Migration complete! Restart Claude Code to apply changes.");
}

/**
 * Restore from Tool Search MCP config to original Claude config.
 */
async function restore(): Promise<void> {
  const fs = await import("node:fs/promises");

  console.log("🔄 Restoring original Claude config...\n");

  // Read Tool Search config
  const toolSearchConfig = await readToolSearchConfig();
  if (!toolSearchConfig) {
    console.error(
      "❌ No Tool Search MCP config found at",
      getToolSearchConfigPath()
    );
    process.exit(1);
  }

  // Read Claude config
  const fullClaudeContent = await fs.readFile(getClaudeConfigPath(), "utf-8");
  const fullClaudeConfig = JSON.parse(fullClaudeContent);

  // Remove tool search tools (keep only non-deferred MCP toolsets)
  fullClaudeConfig.tools = fullClaudeConfig.tools?.filter(
    (tool: { type?: string }) => {
      return (
        !tool.type?.startsWith("tool_search_tool") &&
        tool.type !== "mcp_toolset"
      );
    }
  );

  // Backup and write
  const backupPath = await backupFile(getClaudeConfigPath());
  if (backupPath) {
    console.log(`💾 Backed up current config to: ${backupPath}`);
  }

  await fs.writeFile(
    getClaudeConfigPath(),
    JSON.stringify(fullClaudeConfig, null, 2),
    "utf-8"
  );

  console.log("✅ Restored original Claude config (removed Tool Search)");
  console.log("\n🎉 Restore complete! Restart Claude Code to apply changes.");
}

/**
 * Show current config status.
 */
async function status(): Promise<void> {
  console.log("📊 Config Status\n");

  // Claude config
  const claudeConfig = await readClaudeConfig();
  const claudePath = getClaudeConfigPath();

  console.log(`Claude Config: ${claudePath}`);
  if (claudeConfig?.mcpServers) {
    console.log(
      `  MCP Servers: ${Object.keys(claudeConfig.mcpServers).length}`
    );
    for (const name of Object.keys(claudeConfig.mcpServers)) {
      console.log(`    • ${name}`);
    }

    // Check if tool search is enabled
    const hasToolSearch = (
      claudeConfig.tools as { type?: string }[] | undefined
    )?.some((t) => t.type?.startsWith("tool_search_tool"));
    console.log(
      `  Tool Search: ${hasToolSearch ? "✅ Enabled" : "❌ Disabled"}`
    );
  } else {
    console.log("  Status: ❌ Not found");
  }

  console.log();

  // Tool Search config
  const toolSearchConfig = await readToolSearchConfig();
  const toolSearchPath = getToolSearchConfigPath();

  console.log(`Tool Search Config: ${toolSearchPath}`);
  if (toolSearchConfig) {
    console.log(
      `  MCP Servers: ${Object.keys(toolSearchConfig.mcpServers).length}`
    );
    const searchTool = toolSearchConfig.tools?.find((t) =>
      t.type.startsWith("tool_search_tool")
    );
    if (searchTool && "name" in searchTool) {
      console.log(`  Search Method: ${searchTool.name}`);
    }
  } else {
    console.log("  Status: ❌ Not found");
  }
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(`
Tool Search MCP - Config Migration

Usage: bun run config <command> [options]

Commands:
  migrate [method]   Migrate from ~/.claude.json to use Tool Search MCP
                     Methods: regex (default), bm25, embedding
  restore            Restore original Claude config (remove Tool Search)
  status             Show current config status

Options:
  --help, -h         Show this help message

Examples:
  bun run config status              # Check current status
  bun run config migrate             # Migrate with regex (fastest)
  bun run config migrate embedding   # Migrate with embedding (most accurate)
  bun run config restore             # Restore original config
`);
    process.exit(0);
  }

  switch (command) {
    case "migrate": {
      const method = (args[1] || "regex") as "regex" | "bm25" | "embedding";
      if (!["regex", "bm25", "embedding"].includes(method)) {
        console.error(`❌ Invalid method: ${method}`);
        console.error("   Valid methods: regex, bm25, embedding");
        process.exit(1);
      }
      await migrate(method);
      break;
    }
    case "restore":
      await restore();
      break;
    case "status":
      await status();
      break;
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.error("   Run 'bun run config --help' for usage");
      process.exit(1);
  }
}

main().catch(console.error);
