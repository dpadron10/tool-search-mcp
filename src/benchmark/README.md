# Tool Search MCP Benchmark

Measure the token savings of dynamic tool loading vs loading all tools.

## Running the Benchmark

```bash
bun run benchmark
```

## What It Measures

The benchmark compares two scenarios:

**Scenario A: Standard (Load All Tools)**

- Loads all available tools (built-in + MCP)
- Calculates total token usage
- Represents how Claude Code typically works

**Scenario B: Dynamic (Search + Load Relevant Tools)**

- Uses semantic search to find relevant tools for a query
- Loads only the most relevant tools (top 3 by default)
- Calculates reduced token usage
- Demonstrates the benefit of dynamic tool loading

### Expected Output

```txt
======================================================================
Tool Search MCP Benchmark - Token Usage Comparison
======================================================================

Step 1: Loading all available tools...
  Built-in tools: 10
  MCP tools: 5
  Total tools: 15
  Tool names: read_file, write_file, grep, glob, ...

----------------------------------------------------------------------
Scenario A: Standard (Load ALL Tools)
----------------------------------------------------------------------
  Total tools loaded: 15
  Total payload size: 15,420 chars
  Estimated tokens: 3,855

----------------------------------------------------------------------
Scenario B: Dynamic (Search + Load Relevant Tools)
----------------------------------------------------------------------
  Query: "read and write files to disk"
  Found relevant tools: read_file, write_file
  Tokens: 850, Tools: 2

  Query: "search for text in files using grep"
  Found relevant tools: grep, glob
  Tokens: 920, Tools: 2

  Query: "list directory contents and glob patterns"
  Found relevant tools: list_directory, glob
  Tokens: 780, Tools: 2

  ...

  Average tools loaded: 2
  Average payload size: 1,850 chars
  Average estimated tokens: 463

======================================================================
BENCHMARK RESULTS
======================================================================

Scenario A (All Tools):  3,855 tokens
Scenario B (Dynamic):    463 tokens

Context Saved: 3,392 tokens per query
Percentage Reduction: 88.01%

======================================================================
CONCLUSION
======================================================================

Dynamic tool loading significantly reduces context usage!
By using semantic search to load only relevant tools,
you save ~88.0% of token usage.

This translates to:
- Lower API costs
- Faster response times
- Better Claude performance (less confusion from irrelevant tools)
```

## Interpreting Results

**Key Metrics:**

- **Total Tools**: Number of tools loaded in each scenario
- **Token Reduction**: Percentage of tokens saved by using dynamic loading
- **Context Saved**: Absolute number of tokens saved per query

**What This Means:**

- Lower token usage = lower API costs
- Smaller context window = faster response times
- Fewer irrelevant tools = better Claude performance

## Customizing the Benchmark

Edit `src/benchmark.ts` to customize:

```typescript
// Change the number of tools loaded in dynamic mode
const topK = 3; // Default

// Add your own test queries
const testQueries = [
  "your custom query 1",
  "your custom query 2",
  "your custom query 3",
];
```

## Integration with Claude Code

To measure real-world savings with Claude Code:

1. Run the benchmark to get baseline numbers
2. Configure Claude Code to use this MCP server
3. Monitor actual token usage in production
4. Compare with the benchmark estimates

Expected real-world savings: **70-95%** depending on:

- Number of available tools
- Specificity of user queries
- Tools loaded per conversation
