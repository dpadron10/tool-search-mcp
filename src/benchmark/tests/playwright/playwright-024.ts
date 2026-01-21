/**
 * Playwright Test 024 - Snapshot Long
 */
export const TEST = {
  id: "playwright-024",
  mcpServer: "playwright",
  userPrompt:
    "I need to understand the structure of this page for accessibility testing, please capture an accessibility snapshot that shows all the interactive elements and their roles",
  expectedTools: ["playwright_browser_snapshot"],
  description: "Snapshot - long detailed",
  promptType: "long",
};
export default TEST;
