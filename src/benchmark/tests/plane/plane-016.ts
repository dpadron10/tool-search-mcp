/**
 * Plane Test 016 - Update Work Item Long
 */
export const TEST = {
  id: "plane-016",
  mcpServer: "plane",
  userPrompt:
    "I've finished working on the login bug fix. Please update the work item to mark it as completed and add a comment that the fix has been deployed to staging",
  expectedTools: ["plane_update_work_item"],
  description: "Update work item - long detailed",
  promptType: "long",
};
export default TEST;
