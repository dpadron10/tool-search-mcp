/**
 * Plane Test 003 - Create Work Item Long
 */
export const TEST = {
  id: "plane-003",
  mcpServer: "plane",
  userPrompt:
    "I found a bug in the application where users can't log in using Google OAuth. Please create a new work item in Plane with high priority describing this issue and assign it to the authentication team",
  expectedTools: ["plane_create_work_item"],
  description: "Create work item - long detailed",
  promptType: "long",
};
export default TEST;
