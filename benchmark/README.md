# Tool Search MCP Benchmark Suite

> Comprehensive testing and validation for tool search accuracy and token efficiency.

## 📊 Overview

This benchmark suite validates the Tool Search MCP's ability to correctly identify and recommend tools based on user prompts. It tests multiple search methods (Embedding, BM25, Regex) against real-world test cases derived from your MCP configuration.

## 🧪 Test Structure

### Test Categories

- **Short Prompts (2-5 words)**: Casual, quick commands
- **Medium Prompts (1 sentence)**: Standard user requests
- **Long Prompts (multiple sentences)**: Detailed task descriptions
- **Typos and Variations**: Tests resilience to user errors

### MCP Servers Covered

| Server | Tests | Coverage |
|--------|-------|----------|
| Playwright | 44 | Browser automation |
| Context7 | 12 | Documentation queries |
| Markitdown | 10 | File conversion |
| MiniMax | 15 | Web search & image analysis |
| Plane | 32 | Project management |

**Total: 113 comprehensive test cases**

## 🚀 Usage

### Quick Benchmark (Default)

Runs 5 primary tests - one per MCP server:

```bash
bun run benchmark
```

### Extended Benchmark

Runs all 113 tests with variations:

```bash
bun run benchmark -e
```

### With Claude CLI Validation

Validates against real Claude Code behavior:

```bash
bun run benchmark -c
```

### Verbose Output

Shows detailed test results:

```bash
bun run benchmark -v
```

### Full Benchmark

Tests all models and embedding formats:

```bash
bun run benchmark --full
```

### Combined Options

```bash
# Extended + Claude + Verbose
bun run benchmark -e -c -v
```

## 📈 Interpreting Results

### Method Comparison

| Metric | Description |
|--------|-------------|
| **Accuracy** | Percentage of tests where expected tools were found |
| **Avg Rank** | Average position of correct tool in results (lower = better) |
| **Avg Time** | Search execution time |

### Confidence Levels

| Level | Criteria | Meaning |
|-------|----------|---------|
| 🟢 **HIGH** | 100% accuracy | Ready for production use |
| 🟡 **MEDIUM** | 90-99% accuracy | Good for most use cases |
| 🔴 **LOW** | <90% accuracy | Needs improvement |

### Token Savings

The benchmark calculates token savings by comparing:

- **Traditional Method**: Loading all tools (100% tokens)
- **Tool Search MCP**: Loading only search tool + relevant tools

Typical savings: **97.4% reduction** (~12,950 tokens/query)

## 🏗️ Test File Structure

Each test is an individual file following the pattern:

```
src/benchmark/tests/
├── playwright/
│   ├── playwright-001.ts  # Navigate - short
│   ├── playwright-002.ts  # Navigate - medium
│   └── ...
├── context7/
├── markitdown/
├── minimax/
└── plane/
```

### Test File Format

```typescript
export const TEST = {
  id: "playwright-001",
  mcpServer: "playwright",
  userPrompt: "go to google.com",
  expectedTools: ["playwright_browser_navigate"],
  description: "Navigate - short casual",
  promptType: "short",
  isPrimary: true,  // Included in quick benchmark
};
export default TEST;
```

## 🔍 Search Methods Tested

### 1. Embedding Search (nomic-embed-text-v2-moe)

Uses semantic embeddings for intelligent tool matching.

**Pros:**
- Most accurate (100% on primary tests)
- Understands synonyms and related concepts
- Best for natural language

**Cons:**
- Slower (~311ms average)
- Requires Ollama server

### 2. BM25 Search

Statistical keyword-based ranking algorithm.

**Pros:**
- Fastest (<1ms average)
- No external dependencies
- Good for keyword matching

**Cons:**
- Less flexible with phrasing
- May miss semantic matches

### 3. Regex Search

Pattern matching with heuristic scoring.

**Pros:**
- Lightweight
- Predictable behavior
- Good fallback

**Cons:**
- Limited semantic understanding
- May require tuning for best results

## 🎯 Best Practices

### For Maximum Accuracy

1. Use **Embedding** search method
2. Run quick benchmark: `bun run benchmark`
3. Verify 100% accuracy on primary tests
4. Use Claude CLI validation: `bun run benchmark -c`

### For Maximum Speed

1. Use **BM25** search method
2. Configure in your MCP config
3. Trade-off: ~80% accuracy

### For Production

1. Use **Embedding** with fallback to BM25
2. Monitor accuracy in production
3. Update test cases as needed

## 📊 Example Output

```
Tool Search MCP - Quick Benchmark

Loading MCP tools...
  markitdown: 1 tools
  context7: 2 tools
  playwright: 32 tools
  MiniMax: 2 tools
  plane: 96 tools
  Loaded 133 tools from 5 servers

Running 5 tests across 5 MCP servers...

Testing: embedding (nomic-embed-text-v2-moe)
  5/5 passed (100.0%)

Testing: BM25
  4/5 passed (80.0%)

Testing: Regex
  4/5 passed (80.0%)

═══════════════════════════════════════════════════════
  BENCHMARK RESULTS
═══════════════════════════════════════════════════════

  Method               Accuracy     Avg Rank     Avg Time
  ────────────────────────────────────────────────────
  → embedding (nomic-embed-text-v2-moe) 100.0%       1.80         311ms
    regex               80.0%        1.00         7ms
    bm25                80.0%        2.00         1ms

  Best Method: embedding (nomic-embed-text-v2-moe)

  Can Replace Traditional Method?
  ✓ YES - HIGH CONFIDENCE
  All tests passed - 100% accuracy with token savings

  Token Savings:
  Saved: 97.4% (~12,950 tokens/query)

═══════════════════════════════════════════════════════
  ALL TESTS PASSED (5/5)
═══════════════════════════════════════════════════════
```

## 🔧 Adding New Tests

### 1. Identify the MCP server

```bash
# List available MCP servers in your config
cat ~/.claude.json | jq '.mcpServers | keys'
```

### 2. Create a test file

Create `src/benchmark/tests/[server]/[server]-XXX.ts`:

```typescript
export const TEST = {
  id: "[server]-001",
  mcpServer: "[server]",
  userPrompt: "your test prompt here",
  expectedTools: ["expected_tool_name"],
  description: "Brief description",
  promptType: "short|medium|long",
};
export default TEST;
```

### 3. Add to barrel file

Update `src/benchmark/tests/[server]/index.ts`:

```typescript
export { default as test001 } from "./[server]-001";
export { default as test002 } from "./[server]-002";
// ...
```

### 4. Run benchmark to verify

```bash
bun run benchmark -e
```

## 📈 Benchmarking Philosophy

### Why This Matters

1. **Confidence**: Know your tool search is reliable
2. **Token Savings**: Quantify the benefits
3. **Regression Detection**: Catch issues early
4. **Method Comparison**: Choose the right approach

### Test Quality Standards

- **Realistic Prompts**: Based on actual user behavior
- **Comprehensive Coverage**: All major tools and use cases
- **Error Resilience**: Handle typos and variations
- **Claude Validation**: Verify against real behavior

## 🐛 Troubleshooting

### Tests Failing

1. Check if expected tool name is correct
2. Verify the MCP server is running
3. Run with verbose: `bun run benchmark -v`
4. Review failed test details

### Low Accuracy

1. Try different search method
2. Improve test prompt wording
3. Add more test variations
4. Check tool descriptions

### Claude CLI Not Found

```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude

# Verify installation
claude --version
```

## 📚 Resources

- [Main README](../README.md)
- [Tool Search Implementation](../src/search/)
- [MCP Protocol](https://modelcontextprotocol.io/)
