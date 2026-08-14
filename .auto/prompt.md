# Autoresearch: Reduce distribution file size

## Objective
Reduce the npm distribution size of `pi-codebase-reader` (the packed tarball that
publishes to npm / installs into pi environments) WITHOUT sacrificing the runtime
capability: AST outlines, symbol extraction, and import extraction for all
supported languages (JS/TS, Python, Go, Rust, Solidty, Smali, Java, SCSS, Sass)
must continue to work identically.

Current baseline: packed tarball = 296.8 kB, unpacked = 1.7 MB (153 files).
Breakdown of the 1.7 MB unpacked:
- dist/ (777 KB) — AND src/ (915 KB) BOTH ship
- test files ship in BOTH dirs (17x *.test.ts in src, 17x *.test.js + .test.js.map in dist) ≈ 510 KB
- source maps (.map) ≈ 338 KB
- vendored wasms (tree-sitter-scss.wasm 183KB + tree-sitter-sass.wasm 338KB) = 521 KB — genuinely needed at runtime

## Metrics
- **Primary**: `packed_size` (kB, lower is better) — size of `npm pack` tarball
- **Secondary**: `unpacked_size` (kB, lower is better), `file_count`, `tests_pass` (1/0)

## How to Run
`./.auto/measure.sh` — runs `npm pack`, measures tarball + unpacked sizes, counts
files, and runs the full test suite to verify no behavior regression.

## Files in Scope
- `package.json` — the `files` allowlist and build scripts (primary lever)
- `.npmignore` — may add to exclude test files / maps
- `tsconfig.json` — could disable sourceMap for prod if maps are not needed
- `src/parsers/manager.ts` — wasm resolution (must stay working)

## Off Limits
- `src/parsers/vendor/*.wasm` — the vendored grammars must ship (required at runtime)
- Actual parser logic (`src/**/*.ts` non-test) — technical precision must be preserved
- The README and LICENSE

## Constraints
- All 308 tests must still pass after the change
- `typecheck` and `build` must be clean
- The published package must still resolve wasm from `../../src/parsers/vendor/` at runtime
- `prepublishOnly` runs typecheck + build, and `files` gates what ships

## What's Been Tried
- (empty — start of session)

## Known waste identified (high-confidence targets)
1. Test files ship in both src and dist — publish never needs tests.
2. Source maps (.map, 338KB total) ship — maps are only useful for local debugging.
3. dist/ (777KB) ships alongside src/ (915KB). The runtime entry is `./src/index.ts`
   (pi.extensions); dist is used only by ts-node agnostic consumers. Investigate whether
   dropping dist entirely is safe, or at least stripping tests+maps from dist.