/**
 * Embedding Format Strategies
 *
 * Different strategies for formatting tool definitions into text
 * suitable for embedding generation. The format affects search quality.
 */

import type { EmbeddingFormat, ToolDefinition } from "./types";

export type { EmbeddingFormat } from "./types";

/**
 * Format a tool definition for embedding using the specified strategy.
 *
 * @param tool - Tool definition to format
 * @param format - Format strategy to use
 * @returns Formatted text string for embedding
 */
export function formatToolForEmbedding(
  tool: ToolDefinition,
  format: EmbeddingFormat
): string {
  switch (format) {
    case "minimal":
      return formatMinimal(tool);
    case "standard":
      return formatStandard(tool);
    case "rich":
      return formatRich(tool);
    case "verbose":
      return formatVerbose(tool);
    case "structured":
      return formatStructured(tool);
    default:
      return formatRich(tool);
  }
}

/**
 * Minimal format: just the description.
 * Smallest token count but may miss name-based queries.
 */
function formatMinimal(tool: ToolDefinition): string {
  return tool.description;
}

/**
 * Standard format: name + description.
 * Good balance of brevity and searchability.
 */
function formatStandard(tool: ToolDefinition): string {
  const nameParts = tool.name.replace(/_/g, " ");
  return `${nameParts}: ${tool.description}`;
}

/**
 * Rich format: name + description + parameter names.
 * Better for queries mentioning specific parameters.
 */
function formatRich(tool: ToolDefinition): string {
  const nameParts = tool.name.replace(/_/g, " ");
  const paramNames = Object.keys(tool.input_schema.properties || {}).join(", ");

  let text = `${nameParts} - ${tool.name}: ${tool.description}`;
  if (paramNames) {
    text += `. Parameters: ${paramNames}`;
  }
  return text;
}

/**
 * Verbose format: name + description + parameters with their descriptions.
 * Most comprehensive but highest token count.
 */
function formatVerbose(tool: ToolDefinition): string {
  const nameParts = tool.name.replace(/_/g, " ");
  const props = tool.input_schema.properties || {};

  const paramDescriptions: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "object" && value !== null) {
      const desc = (value as { description?: string }).description;
      if (desc) {
        paramDescriptions.push(`${key}: ${desc}`);
      } else {
        paramDescriptions.push(key);
      }
    }
  }

  let text = `${nameParts} - ${tool.name}: ${tool.description}`;
  if (paramDescriptions.length > 0) {
    text += `. Parameters: ${paramDescriptions.join("; ")}`;
  }
  return text;
}

/**
 * Structured format: JSON-like structured representation.
 * May work better with models trained on code/JSON.
 */
function formatStructured(tool: ToolDefinition): string {
  const props = tool.input_schema.properties || {};
  const required = tool.input_schema.required || [];

  const params = Object.entries(props).map(([key, value]) => {
    const isRequired = required.includes(key);
    const desc =
      typeof value === "object" && value !== null
        ? (value as { description?: string }).description || ""
        : "";
    return `  ${key}${isRequired ? "*" : ""}: ${desc}`;
  });

  let text = `Tool: ${tool.name}\nDescription: ${tool.description}`;
  if (params.length > 0) {
    text += `\nParameters:\n${params.join("\n")}`;
  }
  return text;
}

/**
 * Get all available embedding formats.
 */
export function getAvailableFormats(): EmbeddingFormat[] {
  return ["minimal", "standard", "rich", "verbose", "structured"];
}

/**
 * Get description of a format strategy.
 */
export function getFormatDescription(format: EmbeddingFormat): string {
  const descriptions: Record<EmbeddingFormat, string> = {
    minimal: "Just description (smallest token count)",
    standard: "Name + description",
    rich: "Name + description + parameter names (default)",
    verbose: "Name + description + parameters with descriptions",
    structured: "JSON-like structured format",
  };
  return descriptions[format];
}

/**
 * Estimate token count for a format (rough approximation).
 * Based on ~4 characters per token.
 */
export function estimateFormatTokens(
  tool: ToolDefinition,
  format: EmbeddingFormat
): number {
  const text = formatToolForEmbedding(tool, format);
  return Math.ceil(text.length / 4);
}
