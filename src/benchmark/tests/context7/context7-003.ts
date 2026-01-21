/**
 * Context7 Test 003 - Query Docs Long
 */
export const TEST = {
  id: "context7-003",
  mcpServer: "context7",
  userPrompt:
    "I need to understand how to use the useEffect hook in React for handling side effects and cleanup. Can you query the React documentation and find examples of proper useEffect usage with dependencies?",
  expectedTools: ["context7_query-docs"],
  description: "Query docs - long detailed",
  promptType: "long",
};
export default TEST;
