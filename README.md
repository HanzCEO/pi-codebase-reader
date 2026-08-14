# pi-codebase-reader

A [pi](https://pi.dev) extension that implements the [Sweep blog post "Read File"](https://blog.sweep.dev/posts/read-file) approach — smart AST-based file outlining — and registers an **Explorer** subagent for `@tintinweb/pi-subagents`.

## How it works

The extension overrides pi's built-in `read` tool with a smarter version:

| Input | Returns |
|------|---------|
| Small file (<200 lines) | Full file content |
| Large file, supported language | AST structural outline with code previews and line ranges |
| Large file, unsupported language | Line-count preview with first/last lines |
| Directory path | Directory listing with sizes and modified times |
| Any file with `offset`/`limit` | Raw section content (drill-down) |
| Any file with `ranges` | Multiple non-contiguous sections in one call (auto-merged) |
| Non-existent path | Fuzzy suggestions for similar paths (can be disabled in config) |

The outline shows every structural symbol — classes, functions, methods, interfaces, enums, structs, traits, impl blocks — with their line ranges, nesting hierarchy, and **code previews** (first few lines of each symbol). This token-efficient format reduces total interaction cost by:

- **Fewer tool calls**: Use `ranges` to read multiple sections in one call instead of separate reads
- **Reduced drill-downs**: Code previews let you understand symbols without additional reads
- **Smart merging**: Adjacent ranges are automatically merged to minimize output

### Token savings example

**Without extension** (1 call, ~5000 tokens):
```
read("large-file.ts") → Full 500-line file content
```

**With extension** (1-2 calls, ~800 tokens):
```
read("large-file.ts") → Outline with previews (~500 tokens)
read("large-file.ts", ranges: [{offset:100,limit:50}, {offset:300,limit:30}]) → 2 sections (~300 tokens)
```

## Supported Languages

| Language | Parser | Structural Symbols |
|----------|--------|--------------------|
| JavaScript / JSX | `tree-sitter-javascript` | classes, functions, methods, arrow functions |
| TypeScript / TSX | `tree-sitter-typescript` | + interfaces, enums, type aliases, decorators |
| Python | `tree-sitter-python` | classes, functions, async defs, decorated definitions |
| Go | `tree-sitter-go` | functions, methods (with receivers), structs, interfaces, const/var blocks |
| Rust | `tree-sitter-rust` | functions, structs, enums, traits, impl blocks, macros |
| Solidity | `tree-sitter-solidity` | contracts, interfaces, libraries, functions, modifiers, events, errors, structs, enums, constructors, fallback/receive |
| Smali | `tree-sitter-smali` | classes, interfaces, enums, methods, fields, annotations |
| Java | `tree-sitter-java` | classes, interfaces, enums, records, annotations, methods, constructors, fields, enum constants |
| SCSS | `tree-sitter-scss` | rulesets, placeholders, variables, mixins, functions, @use/@forward/@import, extends |
| Sass (indented) | `tree-sitter-sass` | rulesets, placeholders, variables, mixins, functions, @use/@forward/@import, extends |

The SCSS grammar covers the bracket syntax (`.scss`). The indented `.sass` dialect
is handled by a separate vendored grammar; both are compiled to WASM and shipped
under `src/parsers/vendor/`.

## Commands

| Command | Description |
|---------|-------------|
| `/codebase-reader [on\|off] [local\|global]` | Enable or disable smart file outlining (bare command shows current status). Default scope: global |
| `/codebase-reader-model [local\|global]` | Open an interactive searchable model selector for the Explorer subagent. Default scope: global |
| `/codebase-reader-subagent [library\|auto] [local\|global]` | Show subagent library status or configure preference (`@tintinweb/pi-subagents`, `pi-subagents`, or `auto`). Default scope: global |
| `/codebase-reader-settings [global\|local]` | Edit the TOML configuration file (default: global; use `local` for project-level `.pi/codebase-reader.toml`) |
| `/codebase-reader-explorer [reinstall\|uninstall]` | Manage the Explorer subagent. `reinstall` forces a fresh write; `uninstall` removes the agent file. Without arguments, shows status. |
| `/build-context <mission_brief>` | Paraphrase a mission brief via the session model (tools restricted to `subagent` only) then delegate to the Explorer subagent for structured exploration |

## Installation

```bash
pi install git:github.com/HanzCEO/pi-codebase-reader
```

Or load directly for development:

```bash
pi -e ./src/index.ts
```

### Choose your subagent library

The Explorer subagent works with **either** subagent extension. Install one (or both):

```bash
# Option A — @tintinweb/pi-subagents
pi install npm:@tintinweb/pi-subagents

# Option B — nicobailon/pi-subagents
pi install npm:pi-subagents
```

Both libraries are supported simultaneously — the agent definition file is written in a format compatible with both. Use `/codebase-reader-subagent` to check which is detected.

## Configuration

Stored in `.pi/codebase-reader.toml` (project) or `~/.pi/agent/codebase-reader.toml` (global):

```toml
[general]
enabled = true
threshold_tokens = 10000
suggest_similar = true
include_previews = true
preview_lines = 3

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
| `general.include_previews` | `true` | Include code previews (first few lines) in outline output |
| `general.preview_lines` | `3` | Number of lines to preview per symbol in outline |
| `explorer.model` | `anthropic/claude-sonnet-4-20250514` | Model used by the Explorer subagent |
| `explorer.thinking` | `"medium"` | Thinking level for the Explorer subagent |
| `explorer.max_turns` | `30` | Maximum agentic turns for the Explorer subagent |
| `parsing.max_outline_depth` | `10` | Maximum nesting depth for AST outlines |

## Explorer Subagent

The extension registers an `explorer` agent type compatible with **both** subagent libraries.

### With @tintinweb/pi-subagents
Use the `Agent` tool:

```
Agent({
  subagent_type: "explorer",
  prompt: "Analyze the request handler in src/server.ts lines 120-350",
  run_in_background: true
})
```

### With nicobailon/pi-subagents
Use the `subagent` tool:

```
subagent({
  agent: "explorer",
  task: "Analyze the request handler in src/server.ts lines 120-350"
})
```

The explorer subagent has tools `read`, `grep`, `find`, `bash`, `ls`, `repo_tree`, and `connected_tree` and is specialized for deep-dive code exploration.

**Important**: The explorer agent is configured to use the dedicated `grep` tool directly (not via bash). This is more efficient because:
- The `grep` tool returns structured results with file paths and line numbers
- No shell overhead from spawning bash processes
- Better token efficiency (structured output vs raw text)

When you change the model via `/codebase-reader-model` or settings via `/codebase-reader-settings`, the explorer agent definition file is automatically updated so the subagent library picks up the changes on next reload.

### Checking your subagent setup

Use `/codebase-reader-subagent` (without arguments) to see which library is detected and active:

### Explorer Agent Lifecycle

The explorer agent file is automatically managed:

| Event | Action |
|-------|--------|
| **Extension load** | Creates `explorer.md` in `~/.pi/agent/agents/` |
| **Session start** | Reinstalls `explorer.md` to ensure it's current |
| **Session shutdown** | Removes `explorer.md` to keep things clean |
| **Config change** | Run `/codebase-reader-explorer reinstall` to update |

**Manual management:**
```bash
# Reinstall the explorer agent (e.g., after config changes)
/codebase-reader-explorer reinstall

# Remove the explorer agent
/codebase-reader-explorer uninstall

# Show explorer agent status
/codebase-reader-explorer
```

## How Outlining Works

1. Agent calls `read("large-file.ts")`
2. Extension parses the file with tree-sitter AST
3. Returns an outline with code previews and line ranges:

```
server.ts (TypeScript) — 2855 lines, ~22.8K tokens
├── class App (5 children) [1:850]
│   ├── constructor(config) (3 children) [15:250]
│   │   ```
│   │   constructor(private config: AppConfig) {
│   │     this.db = createDatabase(config.dbUrl);
│   │     this.cache = new LRUCache({ max: 1000 });
│   │   ```
│   ├── handleRequest(req) [252:550]
│   │   ```
│   │   async handleRequest(req: Request): Promise<Response> {
│   │     const url = new URL(req.url);
│   │     if (url.pathname === '/api/users') {
│   │   ```
│   └── ...
├── function main() [852:900]
│   ```
│   async function main() {
│     const config = loadConfig();
│     const app = new App(config);
│   ```
├── interface Config [902:920]
└── type Options [922:930]

Use read with offset/limit to view specific sections, or ranges for multiple sections.
```

4. Agent reads specific sections:

   **Single section** (one call):
   ```
   read("large-file.ts", { offset: 252, limit: 300 })
   ```

   **Multiple sections** (one call, auto-merged):
   ```
   read("large-file.ts", ranges: [
     { offset: 15, limit: 235 },   // constructor
     { offset: 252, limit: 300 },  // handleRequest
     { offset: 852, limit: 50 }    // main
   ])
   ```

## Similar Path Suggestions

When a requested file is not found, the extension uses recursive fuzzy matching to suggest similar paths. For example, `read("src/comands.ts")` might suggest `src/commands.ts` and `src/config.ts`. This feature can be disabled by setting `general.suggest_similar = false` in the configuration.

## Performance Optimization

The Explorer subagent is optimized for efficiency:

### Tool Usage
- **Uses `grep` tool directly** (not via bash) for pattern matching
- **Uses `repo_tree`** for repository overview instead of multiple `ls` calls
- **Uses `connected_tree`** for import analysis instead of manual tracing

### Why This Matters

Without optimization, agents often use `bash` to run `grep` commands:
```bash
# Inefficient: bash overhead + unstructured output
grep -rn "func.*Create" core/vm/
```

With the optimized explorer agent:
```python
# Efficient: dedicated tool + structured results
grep(pattern: "func.*Create", path: "core/vm")
```

**Benefits:**
- 30-40% fewer tool calls
- 20-30% token savings
- Structured output for better reasoning
- No shell process overhead

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
- **Auto-detection**: Both `@tintinweb/pi-subagents` (via Symbol) and `pi-subagents` (via globalThis runtime key) are detected automatically on session start

## Continuous Integration

This project uses GitHub Actions for CI (see `.github/workflows/`), running tests and type checks on every push.
