/**
 * MiniMax Test 011 - Image Analysis Long
 */
export const TEST = {
  id: "minimax-011",
  mcpServer: "MiniMax",
  userPrompt:
    "I have a screenshot of an error message that I need help understanding. Can you analyze the image at ~/Desktop/error.png and tell me what the error is about and how I might fix it?",
  expectedTools: ["MiniMax_understand_image"],
  description: "Image analysis - long detailed",
  promptType: "long",
};
export default TEST;
