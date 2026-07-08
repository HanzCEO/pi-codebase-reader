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
| Non-existent path | Fuzzy suggestions for similar paths (can be disabled in config) |

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
| `/codebase-reader [on\|off] [local\|global]` | Enable or disable smart file outlining (bare command shows current status). Default scope: global |
| `/codebase-reader-model [local\|global]` | Open an interactive searchable model selector for the Explorer subagent. Default scope: global |
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
suggest_similar = true

[explorer]
model = "anthropic/claude-sonnet-4-20250514"
thinking = "medium"
max_turns = 30

[parsing]
max_outline_depth = 10
```

### Configuration Reference

| Key | Default | Description |
|-----|---------|-------------|
| `general.enabled` | `true` | Enable/disable smart file outlining |
| `general.threshold_tokens` | `10000` | Token budget for AST outlines; outlines exceeding this are progressively shallowed |
| `general.suggest_similar` | `true` | When a file path is not found, suggests similar paths via recursive fuzzy matching |
| `explorer.model` | `anthropic/claude-sonnet-4-20250514` | Model used by the Explorer subagent |
| `explorer.thinking` | `"medium"` | Thinking level for the Explorer subagent |
| `explorer.max_turns` | `30` | Maximum agentic turns for the Explorer subagent |
| `parsing.max_outline_depth` | `10` | Maximum nesting depth for AST outlines |

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

When you change the model via `/codebase-reader-model` or settings via `/codebase-reader-settings`, the explorer agent definition file is automatically updated so pi-subagents picks up the changes on next reload.

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

## Similar Path Suggestions

When a requested file is not found, the extension uses recursive fuzzy matching to suggest similar paths. For example, `read("src/comands.ts")` might suggest `src/commands.ts` and `src/config.ts`. This feature can be disabled by setting `general.suggest_similar = false` in the configuration.

## Model Selection TUI

The `/codebase-reader-model` command opens a fully interactive terminal UI that:
- Lists all available models from pi's model registry (deduplicated, sorted)
- Provides real-time keyboard filtering as you type
- Supports arrow key navigation, Enter to select, and Esc to cancel
- Persists the selection to configuration and updates the Explorer subagent automatically

## Lifecycle Integration

The extension hooks into pi's session lifecycle:
- **`session_start`**: Reloads configuration and re-registers the Explorer agent for each new session
- **`subagents:ready`**: Listens for the `@tintinweb/pi-subagents` readiness signal to confirm the Explorer agent is available

## Continuous Integration

This project uses GitHub Actions for CI (see `.github/workflows/`), running tests and type checks on every push.
