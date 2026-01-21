/**
 * Playwright Test 016 - Screenshot Long
 */
export const TEST = {
  id: "playwright-016",
  mcpServer: "playwright",
  userPrompt:
    "I want to capture what the webpage currently looks like, please take a full page screenshot so I can review the design and layout of the page",
  expectedTools: ["playwright_browser_take_screenshot"],
  description: "Screenshot - long detailed",
  promptType: "long",
};
export default TEST;
