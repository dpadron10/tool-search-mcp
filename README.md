# Tool Search MCP

> ⚠️ **Warning: This project is still in experimental phase (v0.0.1). APIs and features may change.**

A high-performance, client-side tool search service for Claude Code that dynamically searches and loads relevant MCP tools instead of loading all tools at once. Built with semantic search technology using Ollama embeddings for intelligent tool matching.

## 🎯 Key Benefits

### Technical Advantages

- **97.4% Token Reduction**: Benchmarks show ~12,950 tokens saved per query on average
- **100% Tool Selection Accuracy**: With embedding-based search, all primary test cases pass
- **Faster Context Windows**: Smaller tool payloads mean more room for actual conversation
- **Smart Tool Discovery**: Semantic search finds the right tool even with natural language queries
- **Multiple Search Methods**: Choose between Embedding (most accurate), BM25 (fastest), or Regex (lightweight)

### Business Impact

- **Reduced API Costs**: Fewer tokens = lower Claude API bills
- **Better Performance**: Faster response times with optimized tool selection
- **Scalability**: Load hundreds of MCP servers without hitting context limits
- **Developer Experience**: Natural language tool discovery feels more intuitive

### Benchmark Results

| Method | Quick Mode (5 tests) | Extended (113 tests) | Speed |
|--------|---------------------|----------------------|-------|
| **Embedding** | **100%** ✓ | 88.5% | 311ms |
| BM25 | 80% | 81.4% | 1ms |
| Regex | 80% | 79.6% | 7ms |

**Best for accuracy**: Embedding with `nomic-embed-text-v2-moe`  
**Best for speed**: BM25 with sub-millisecond response

## 🚀 Quick Start

```bash
# Run directly without installation
bun x github:ImBIOS/tool-search-mcp

# Or install locally
git clone https://github.com/ImBIOS/tool-search-mcp.git
cd tool-search-mcp
bun install
bun run dev
```

## 📋 Prerequisites

### 1. Install Ollama

```bash
# Linux/macOS
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama server
ollama serve
```

### 2. Pull the embedding model

```bash
ollama pull nomic-embed-text-v2-moe
```

This model is optimized for generating embeddings and is much smaller than full LLMs.

## ⚡ Installation

```bash
# Clone and install
git clone https://github.com/ImBIOS/tool-search-mcp.git
cd tool-search-mcp
bun install

# Development mode (with hot reload)
bun run dev

# Production mode
bun run build
bun start
```

## 🔧 Configuration

### Quick Configuration (Environment Variables)

```bash
export MCP_CONFIG='{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "your-token" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}'
```

### Configuration File

```bash
export MCP_CONFIG_PATH=./mcp-config.json
```

Where `mcp-config.json` contains:

```json
{
  "mcpServers": {
    "dbhub": {
      "command": "npx",
      "args": ["-y", "@bytebase/dbhub@latest", "--port", "8082"],
      "env": { "DSN": "postgres://user:pass@localhost/db" }
    }
  }
}
```

## 📊 Usage

### Basic Search

```bash
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -d '{"query": "read a file from disk", "topK": 3}'
```

Response:

```json
{
  "type": "tool_result",
  "content": {
    "type": "tool_search_result",
    "tool_references": [
      { "type": "tool_reference", "tool_name": "read_file" },
      { "type": "tool_reference", "tool_name": "list_directory" },
      { "type": "tool_reference", "tool_name": "glob" }
    ]
  },
  "meta": {
    "model": "nomic-embed-text-v2-moe",
    "took": 45,
    "results": [...]
  }
}
```

### Health Check

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "healthy",
  "ollamaConnected": true,
  "model": "nomic-embed-text-v2-moe",
  "toolsLoaded": 10
}
```

## 🧪 Benchmark

Run comprehensive benchmarks to validate tool search accuracy:

```bash
# Quick benchmark (5 primary tests, one per MCP)
bun run benchmark

# Extended benchmark (113 tests with variations)
bun run benchmark -e

# With Claude CLI validation
bun run benchmark -c

# With verbose output
bun run benchmark -v

# Full benchmark (all models and formats)
bun run benchmark --full
```

### Config Migration

```bash
# Check current status
bun run config status

# Migrate to Tool Search MCP (regex - fastest)
bun run config migrate

# Migrate with embedding (most accurate)
bun run config migrate embedding

# Restore original config
bun run config restore
```

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Claude Code │────▶│ Tool Search API  │────▶│   Ollama    │
│             │     │ (this service)   │     │ nomic-embed-│
│             │◀────│                  │◀────│ text-v2-moe │
└─────────────┘     └──────────────────┘     └─────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │   Tools DB   │
                   │ (embeddings) │
                   └──────────────┘
                          ▲
                          │
                   ┌──────────────┐
                   │   MCP        │
                   │   Servers    │
                   └──────────────┘
```

## 🔍 Search Methods

### 1. Embedding Search (Recommended)

Uses semantic embeddings with cosine similarity for the most accurate tool matching. Best for natural language queries.

```json
{
  "type": "tool_search_tool_embedding"
}
```

### 2. BM25 Search (Fastest)

Statistical keyword-based search. Lightning fast but less flexible with phrasing.

```json
{
  "type": "tool_search_tool_bm25_20251119"
}
```

### 3. Regex Search (Lightweight)

Pattern matching with heuristic scoring. Minimal overhead.

```json
{
  "type": "tool_search_tool_regex_20251119"
}
```

## 📁 Project Structure

```
tool-search-mcp/
├── src/
│   ├── benchmark/         # Benchmark suite
│   │   └── tests/         # Test cases per MCP
│   ├── cli/               # CLI tools
│   ├── search/            # Search engine implementations
│   └── index.ts           # Main entry point
├── package.json
└── README.md
```

## 🛠️ Development

```bash
# Type checking
bun run check-types

# Formatting
bun run format:ws

# Build
bun run build
```

## 📝 License

MIT

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines first.

## 📧 Support

- Open an issue on GitHub
- Email: imamuzzaki@gmail.com

## 🔗 Related Links

- [GitHub Repository](https://github.com/ImBIOS/tool-search-mcp)
- [Nomic Embed Text Model](https://ollama.com/library/nomic-embed-text-v2-moe)
- [Model Context Protocol](https://modelcontextprotocol.io/)
