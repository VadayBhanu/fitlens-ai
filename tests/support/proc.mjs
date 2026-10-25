// Cross-platform helpers for test harnesses that run Wrangler.
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

/** Run Wrangler's JS entry with the current Node binary (works on Windows and paths with spaces). */
export function wranglerRunner(root) {
  const entry = join(root, "node_modules/wrangler/bin/wrangler.js");
  return {
    sync: (args, opts) => execFileSync(process.execPath, [entry, ...args], opts),
    spawn: (args, opts) => spawn(process.execPath, [entry, ...args], opts)
  };
}

/** Stop a process and its children (Wrangler spawns workerd). */
export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  } catch {
    /* already exited */
  }
}

/** Remove a temp dir; on Windows SQLite handles can linger briefly after the process exits. */
export function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* best effort */
  }
}
