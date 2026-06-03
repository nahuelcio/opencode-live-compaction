#!/usr/bin/env node
/**
 * opencode-live-compaction — npx installer
 *
 * Usage:
 *   npx opencode-live-compaction
 *   npx opencode-live-compaction /path/to/project
 */
import { cpSync, mkdirSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const targetDir = resolve(process.argv[2] || ".")
const pluginDir = join(targetDir, ".opencode", "plugins", "live-compaction")
const srcDir = join(__dirname, "..", "src")

// Colors
const green = (s) => `\x1b[32m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

console.log(cyan("[info]") + `  Installing opencode-live-compaction into ${targetDir}`)

if (!existsSync(srcDir)) {
  console.log(red("[error]") + " Source files not found")
  process.exit(1)
}

// Create plugin directory
mkdirSync(pluginDir, { recursive: true })

// Copy source files
const files = ["index.ts", "prompt.ts", "files-touched.ts"]
for (const file of files) {
  const src = join(srcDir, file)
  if (!existsSync(src)) {
    console.log(red("[error]") + ` Missing source file: ${file}`)
    process.exit(1)
  }
  cpSync(src, join(pluginDir, file))
}

console.log(green("[ok]") + "    Plugin installed to " + pluginDir + "/")
console.log(green("[ok]") + "    ├── index.ts")
console.log(green("[ok]") + "    ├── prompt.ts")
console.log(green("[ok]") + "    └── files-touched.ts")

// Check opencode.json
const configFile = join(targetDir, "opencode.json")
if (existsSync(configFile)) {
  const content = await import("node:fs").then(fs => fs.readFileSync(configFile, "utf-8"))
  if (content.includes("opencode-live-compaction")) {
    console.log(green("[ok]") + "    opencode.json already references the plugin")
  } else {
    console.log(green("[ok]") + "    Local plugin is already active — no config change needed.")
  }
} else {
  console.log(cyan("[info]") + "  The local plugin will be auto-loaded from .opencode/plugins/")
}

console.log("")
console.log(green("[ok]") + "    Done! OpenCode will use enhanced 11-section compaction on next session.")
