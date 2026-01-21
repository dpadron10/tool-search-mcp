/**
 * Markitdown Test 010 - Convert Image
 */
export const TEST = {
  id: "markitdown-010",
  mcpServer: "markitdown",
  userPrompt:
    "Extract text from this image and convert to markdown: screenshot.png",
  expectedTools: ["markitdown_convert_to_markdown"],
  description: "Convert image - medium",
  promptType: "medium",
};
export default TEST;
