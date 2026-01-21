/**
 * Context7 Test 011 - Resolve Library Long
 */
export const TEST = {
  id: "context7-011",
  mcpServer: "context7",
  userPrompt:
    "Before I can query the documentation, I need to find the correct Context7 library ID for the express.js framework. Can you resolve the library identifier first?",
  expectedTools: ["context7_resolve-library-id"],
  description: "Resolve library - long detailed",
  promptType: "long",
};
export default TEST;
