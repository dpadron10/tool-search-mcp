/**
 * Plane Test 009 - List Work Items Long
 */
export const TEST = {
  id: "plane-009",
  mcpServer: "plane",
  userPrompt:
    "I need to see all the open issues and tasks in our project management system. Can you list all the work items so I can review what needs to be done this sprint?",
  expectedTools: ["plane_list_work_items"],
  description: "List work items - long detailed",
  promptType: "long",
};
export default TEST;
