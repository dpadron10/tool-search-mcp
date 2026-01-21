/**
 * Markitdown Test 002 - Convert PDF Medium
 */
export const TEST = {
  id: "markitdown-002",
  mcpServer: "markitdown",
  userPrompt: "Convert this PDF to markdown: /home/user/docs/report.pdf",
  expectedTools: ["markitdown_convert_to_markdown"],
  description: "Convert PDF - medium",
  promptType: "medium",
};
export default TEST;
