// Copies Bryntum's prebuilt scheduler into public/ before every build and dev
// start. The browser loads it as a plain script, so Turbopack never parses the
// 4.6 MB obfuscated trial file, which ran a Linux build past 8 GB of memory.
// The copy runs after install, so it carries the trial ID the postinstall wrote.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve("@bryntum/scheduler/package.json"));
const target = join(import.meta.dirname, "..", "public", "bryntum");

mkdirSync(target, { recursive: true });
copyFileSync(join(packageDir, "scheduler.umd.js"), join(target, "scheduler.umd.js"));
