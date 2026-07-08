**Findings**
- Runtime `console.warn` messages about subagent detection are in `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:67`, `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:80`, `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:84`, `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:91`, `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:120`, `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:124`, and `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:132`.
- No `console.log` calls matching subagent availability/detection were found under `/home/hanz/Documents/OpenSource/pi-codebase-reader/src`.
- `detectSubagentLibrary` is defined in `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/explorer-agent.ts:154` and called from `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:77` and `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/commands.ts:418`.
- Potential “too early” initialization is in `/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:35`: the extension default export immediately runs `ensureExplorerAgent`, probes globals, and logs “No subagent library detected” before `session_start`; the detector comment itself warns init-time detection may be unreliable.

**Relevant Snippets**
`/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:72`
```ts
const tintinwebAvailable = isTintinwebSubagentsAvailable();
const nicobailonAvailable = isNicobailonSubagentsAvailable();
const detectedLib = config.subagent?.library
  ? (config.subagent.library as SubagentLibrary)
  : detectSubagentLibrary();
```

`/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:79`
```ts
if (tintinwebAvailable) {
  console.warn("[codebase-reader] @tintinweb/pi-subagents detected — Explorer agent available via Agent tool");
} else if (nicobailonAvailable) {
  console.warn("[codebase-reader] pi-subagents (nicobailon) detected — Explorer agent available via subagent tool");
} else {
  console.warn(`[codebase-reader] No subagent library detected${hint}. ` + `Install one:\n` + ...);
}
```

`/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:114`
```ts
// Re-check subagents on session start (they may have been loaded after us)
pi.on("session_start", async () => {
  const tintinweb = isTintinwebSubagentsAvailable();
  const nicobailon = isNicobailonSubagentsAvailable();
```

`/home/hanz/Documents/OpenSource/pi-codebase-reader/src/index.ts:130`
```ts
pi.events.on("subagents:ready", () => {
  console.warn("[codebase-reader] @tintinweb/pi-subagents ready — Explorer agent ready");
});
```

`/home/hanz/Documents/OpenSource/pi-codebase-reader/src/explorer-agent.ts:150`
```ts
// Note: at extension init time, other extensions may not have completed
// initialization yet. This function is most reliable when called from
// a session_start handler or later.
export function detectSubagentLibrary(): SubagentLibrary {
```

`/home/hanz/Documents/OpenSource/pi-codebase-reader/src/commands.ts:414`
```ts
if (!action) {
  const detected = detectSubagentLibrary();
  ...
  lines.push(`${ctx.ui.theme.fg("warning", "○")} No subagent library detected`);
}
```