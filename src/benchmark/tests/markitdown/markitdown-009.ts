/**
 * Markitdown Test 009 - Convert Excel
 */
export const TEST = {
  id: "markitdown-009",
  mcpServer: "markitdown",
  userPrompt:
    "Can you convert my Excel spreadsheet at data.xlsx to markdown tables?",
  expectedTools: ["markitdown_convert_to_markdown"],
  description: "Convert Excel - medium",
  promptType: "medium",
};
export default TEST;
