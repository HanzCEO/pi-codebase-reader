/**
 * npm postuninstall script — removes the Explorer agent definition file.
 * This runs when `npm uninstall` (or `pi uninstall`) removes the package,
 * ensuring the explorer.md agent file is cleaned up from ~/.pi/agent/agents/.
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const agentsDir = join(homedir(), ".pi", "agent", "agents");
const mdPath = join(agentsDir, "explorer.md");

if (existsSync(mdPath)) {
  try {
    unlinkSync(mdPath);
    console.log(`[pi-codebase-reader] Explorer agent removed: ${mdPath}`);
  } catch (err) {
    console.error(
      `[pi-codebase-reader] Failed to remove explorer agent during uninstall:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
