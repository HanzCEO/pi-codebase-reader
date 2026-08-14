# Ideas Backlog

- [ ] **Minify shipped TS source** — jiti loads .ts via transpile; shipping minified .ts could save ~5-7 kB gzipped but harms readability of an OSS package and risks subtle breakage. LOW priority.
- [ ] **License mismatch** — package.json says MIT but LICENSE file is Apache 2.0. Not a size issue, but a correctness/legal issue worth flagging to the user. OUT OF SCOPE for size.
- [ ] **wasm-opt --strip-name-section** — flag not supported in wasm-opt 112; only --strip-debug/--strip-producers available, saving ~100 bytes gzipped. NOT worth it.
- [ ] **Check if npm pack compression level is configurable** — npm uses gzip; no exposed level flag. Dead end.
- [ ] **Vendor scss/sass wasm from a smaller source** — grammars are irreducible data; no smaller alternative exists. Dead end.
