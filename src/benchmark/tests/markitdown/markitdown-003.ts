/**
 * Markitdown Test 003 - Convert Long
 */
export const TEST = {
  id: "markitdown-003",
  mcpServer: "markitdown",
  userPrompt:
    "I have a Word document that I need to convert to markdown format so I can include it in my GitHub repository. The file is located at /home/user/documents/proposal.docx. Please convert it to markdown.",
  expectedTools: ["markitdown_convert_to_markdown"],
  description: "Convert - long detailed",
  promptType: "long",
};
export default TEST;
