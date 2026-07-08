# pi-codebase-reader

A [pi](https://pi.dev) extension that implements the [Sweep blog post "Read File"](https://blog.sweep.dev/posts/read-file) approach — smart AST-based file outlining — and registers an **Explorer** subagent for `@tintinweb/pi-subagents`.

## How it works

The extension overrides pi's built-in `read` tool with a smarter version:

| Input | Returns |
|------|---------|
| Small file (<200 lines) | Full file content |
| Large file, supported language | AST structural outline with line ranges |
| Large file, unsupported language | Line-count preview with first/last lines |
| Directory path | Directory listing with sizes and modified times |
| Any file with `offset`/`limit` | Raw section content (drill-down) |

The outline shows every structural symbol — classes, functions, methods, interfaces, enums, structs, traits, impl blocks — with their line ranges and nesting hierarchy, using a token-efficient format that saves up to **90% token usage** on large files.

## Supported Languages

| Language | Parser | Structural Symbols |
|----------|--------|--------------------|
| JavaScript / JSX | `tree-sitter-javascript` | classes, functions, methods, arrow functions |
| TypeScript / TSX | `tree-sitter-typescript` | + interfaces, enums, type aliases, decorators |
| Python | `tree-sitter-python` | classes, functions, async defs, decorated definitions |
| Go | `tree-sitter-go` | functions, methods (with receivers), structs, interfaces, const/var blocks |
| Rust | `tree-sitter-rust` | functions, structs, enums, traits, impl blocks, macros |

## Commands

| Command | Description |
|---------|-------------|
| `/codebase-reader on` | Enable smart file outlining |
| `/codebase-reader off` | Disable — files return full content |
| `/codebase-reader-model` | Open model selector for the Explorer subagent |
| `/codebase-reader-settings [global\|local]` | Edit the TOML configuration file (default: global; use `local` for project-level `.pi/codebase-reader.toml`) |

## Installation

```bash
pi install git:github.com/HanzCEO/pi-codebase-reader
```

Or load directly for development:

```bash
pi -e ./src/index.ts
```

Requires `@tintinweb/pi-subagents` for subagent support:

```bash
pi install npm:@tintinweb/pi-subagents
```

## Configuration

Stored in `.pi/codebase-reader.toml` (project) or `~/.pi/agent/codebase-reader.toml` (global):

```toml
[general]
enabled = true
threshold_tokens = 10000

[explorer]
model = "anthropic/claude-sonnet-4-20250514"
thinking = "medium"
max_turns = 30

[parsing]
max_outline_depth = 10
```

## Explorer Subagent

The extension registers an `explorer` agent type with `@tintinweb/pi-subagents`. Use it via the `Agent` tool:

```
Agent({
  subagent_type: "explorer",
  prompt: "Analyze the request handler in src/server.ts lines 120-350",
  run_in_background: true
})
```

The explorer subagent has tools `read`, `grep`, `find`, `bash`, `ls` and is specialized for deep-dive code exploration.

## How Outlining Works

1. Agent calls `read("large-file.ts")`
2. Extension parses the file with tree-sitter AST
3. Returns an outline with line ranges:

```
server.ts (TypeScript) — 2855 lines, ~22.8K tokens
├── class App (5 children) [1:850]
│   ├── constructor(config) (3 children) [15:250]
│   ├── handleRequest(req) [252:550]
│   └── ...
├── function main() [852:900]
├── interface Config [902:920]
└── type Options [922:930]

Use read with offset/limit to view specific sections.
```

4. Agent reads specific sections by calling `read("large-file.ts", { offset: 252, limit: 298 })`
