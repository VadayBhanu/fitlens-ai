// Bundles the extension with esbuild into dist/ (load dist/ as an unpacked extension).
//   node build.mjs            production build
//   node build.mjs --watch    rebuild on change
//   node build.mjs --zip      build + create release/fitlens-extension-<version>.zip for the Chrome Web Store
// Configure endpoints with FITLENS_API_URL and FITLENS_WEB_URL (users can also change them in Settings).
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, process.env.FITLENS_OUT_DIR ?? "dist");
const watch = process.argv.includes("--watch");
const zip = process.argv.includes("--zip");

const define = {
  __FITLENS_API_URL__: JSON.stringify(process.env.FITLENS_API_URL ?? "http://localhost:8787"),
  __FITLENS_WEB_URL__: JSON.stringify(process.env.FITLENS_WEB_URL ?? "http://localhost:5173"),
  "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production")
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(here, "public"), dist, { recursive: true });
if (process.env.FITLENS_E2E) {
  // Test builds only: let automated tests inject the content script without a toolbar click.
  const manifestPath = join(dist, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["http://localhost/*", "http://127.0.0.1/*"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

const common = { bundle: true, minify: !watch, sourcemap: watch ? "inline" : false, target: "chrome116", define, logLevel: "info" };
const builds = [
  { ...common, entryPoints: [join(here, "src/background.ts")], outfile: join(dist, "background.js"), format: "esm" },
  { ...common, entryPoints: [join(here, "src/content.ts")], outfile: join(dist, "content.js"), format: "iife" },
  { ...common, entryPoints: [join(here, "src/sidepanel/main.tsx")], outfile: join(dist, "sidepanel.js"), format: "iife", jsx: "automatic" },
  { ...common, entryPoints: [join(here, "src/sidepanel/sidepanel.css")], outfile: join(dist, "sidepanel.css") }
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log("Watching… load apps/extension/dist as an unpacked extension.");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  if (zip) {
    const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
    const release = join(here, "release");
    mkdirSync(release, { recursive: true });
    const out = join(release, `fitlens-extension-${version}.zip`);
    rmSync(out, { force: true });
    execFileSync("zip", ["-r", "-q", out, "."], { cwd: dist });
    console.log(`Packaged ${out}`);
  }
}
