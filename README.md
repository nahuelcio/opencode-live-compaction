# opencode-live-compaction

Enhanced context compaction plugin for [OpenCode](https://opencode.ai) — structured summaries with files-touched manifests, task-state continuity, tool output trimming, deduplication, error purging, protected file patterns, turn protection, compress tool, and slash commands.

## What it does

OpenCode's built-in compaction produces a 7-section summary. This plugin replaces it with an **11-section structured summary** and adds proactive context optimization strategies that reduce token usage *before* compaction triggers.

### Built-in vs opencode-live-compaction

| | OpenCode Built-in | opencode-live-compaction |
|---|---|---|
| **Summary sections** | 7 (Goal, Constraints, Progress, Decisions, Next Steps, Critical Context, Relevant Files) | **11** (Brief, User Intent Trail, Constraints, Errors/Dead Ends, Decisions, Status, Task Continuity, Open Issues, Next Steps, Mandatory Reading, Files Touched) |
| **User intent** | Captured as "Goal" | **Chronological intent trail** with direction changes |
| **Dead ends** | Not tracked | **Dedicated section** for failed approaches |
| **Task continuity** | Not captured | **Exact moment** where work stopped |
| **Files touched** | "Relevant Files" section | **Operation-badge manifest** (`R`=read, `E`=edit, `W`=write, `D`=delete) |
| **Prompt** | Hardcoded | Replaced via plugin hook (customizable) |
| **Tool output size** | Unmanaged | **Configurable per-tool trim limits** |
| **Duplicate tool calls** | Kept as-is | **Deduplicated** (keeps only latest) |
| **Errored tool inputs** | Kept forever | **Purged** after N turns (error output preserved) |
| **Manual compaction** | `/compact` only | `/compact` + `/compact:focus <goal>` |
| **Protected files** | None | **Glob patterns** (`CLAUDE.md`, `**/*.config.ts`) never trimmed |
| **Recent turn protection** | None | **Last N turns** protected from trimming (default: 4) |
| **Compress tool** | None | Model-driven **compress** tool for proactive context management |

## Install

### Option 1: One-liner (curl + bash) — macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/nahuelcio/opencode-live-compaction/master/install.sh | bash
# or specify a project directory:
curl -fsSL https://raw.githubusercontent.com/nahuelcio/opencode-live-compaction/master/install.sh | bash -s /path/to/project
```

### Option 2: One-liner (PowerShell) — Windows

```powershell
irm https://raw.githubusercontent.com/nahuelcio/opencode-live-compaction/master/install.ps1 | iex
# or specify a project directory:
irm https://raw.githubusercontent.com/nahuelcio/opencode-live-compaction/master/install.ps1 | iex -TargetDir C:\path\to\project
```

### Option 3: npm plugin

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-live-compaction"]
}
```

### Option 4: Manual

```bash
git clone https://github.com/nahuelcio/opencode-live-compaction.git
cp -r opencode-live-compaction/src/* .opencode/plugins/live-compaction/
```

## How it works

The plugin hooks into five OpenCode plugin events:

### 1. `tool.execute.after` — Files tracking

Records every file operation (read, write, edit, delete) during the session. Produces a manifest like:

```
- `src/index.ts` `R` `E`
- `src/config.ts` `R` `W`
- `test/app.test.ts` `R`
```

### 2. `experimental.chat.messages.transform` — Context optimization

Runs on every message batch sent to the LLM. Applies three strategies in order:

1. **Tool output trimming** — Truncates long tool outputs (bash, read, grep, etc.) to configurable limits. Keeps the *end* of the output (usually has the result/error).
2. **Deduplication** — When the same tool is called with the same args multiple times, only the latest output is kept. Earlier duplicates are replaced with a short marker.
3. **Error input purging** — Strips the large input content from errored tool calls (the error message is preserved).

### 3. `experimental.session.compacting` — Enhanced prompt

When compaction triggers (automatic or manual `/compact`), replaces the default prompt with the enhanced 11-section template:

1. **Brief** — Executive summary
2. **User Intent Trail** — Chronological goals with direction changes
3. **Constraints & Preferences** — User constraints and specs
4. **Errors & Dead Ends** — Failed approaches and why
5. **Key Decisions** — Decision log with rationale
6. **Status** — Done / In Progress / Blocked
7. **Task Continuity** — Exact state when compaction triggered
8. **Open Issues & Questions** — Unresolved items
9. **Next Steps** — Ordered actions to resume
10. **Mandatory Reading** — Files that must be read first
11. **Files Touched Manifest** — All files with operation badges

### 4. `experimental.compaction.autocontinue` — Auto-resume

Ensures the session continues automatically after compaction so work isn't interrupted.

## Slash Commands

| Command | Description |
|---|---|
| `/compact` | Trigger manual compaction (passed through to OpenCode) |
| `/compact:focus <directive>` | Set a focus directive that gets injected into the next compaction prompt |

The focus directive tells the summarizer to prioritize a specific goal through compaction:

```
/compact:focus Fix the authentication bug in login.ts
```

This adds a `<focus-directive>` block to the compaction prompt, ensuring the summary preserves context relevant to that goal.

## Compress Tool

The plugin exposes a `compress` tool to the model, enabling proactive context management. The model decides when to compress and writes the summary itself (it has full context).

| Parameter | Type | Description |
|---|---|---|
| `topic` | string | Short label (3-5 words) for display |
| `start` | number | Start message index (inclusive, 0-based) |
| `end` | number | End message index (inclusive, 0-based) |
| `summary` | string | Complete technical summary replacing the range |

When the model calls `compress`, the specified message range is replaced with a `<compressed-block>` containing the summary. This happens on the next message transform cycle.

## Protected File Patterns

Files matching glob patterns are never trimmed, even if their outputs exceed the configured limits. Useful for critical context files:

```jsonc
{
    "protectedFilePatterns": [
        "CLAUDE.md",
        "**/*.config.ts",
        ".env*",
        "**/schema.prisma"
    ]
}
```

Supports: `*` (any except `/`), `**` (any including `/`), `?` (single char).

## Turn Protection

Tool outputs from recent conversation turns are protected from trimming. The last N user turns (default: 4) are never trimmed, ensuring recently-read files stay in context:

```jsonc
{
    "turnProtection": {
        "enabled": true,
        "turns": 4
    }
}
```

## Configuration

No configuration needed — the plugin works out of the box with sensible defaults. To customize, create a config file at:

```
.opencode/live-compaction.json
```

or (with comment support):

```
.opencode/live-compaction.jsonc
```

### Default Configuration

```jsonc
{
    // Enable/disable the entire plugin
    "enabled": true,

    // Enable debug logging (logs to OpenCode's app log)
    "debug": false,

    // Tool output trim limits (max chars to keep per tool type)
    "trim": {
        "bash": 600,     // Shell outputs (logs, test runs)
        "write": 100,    // File write confirmations
        "edit": 100,     // Edit confirmations
        "delete": 50,    // Delete confirmations
        "read": 300,     // File reads
        "glob": 200,     // File listings
        "grep": 400,     // Search results
        "list": 200,     // Directory listings
        "default": 500   // Any unlisted tool
    },

    // Deduplication: remove duplicate tool calls (same tool + same args)
    "dedup": {
        "enabled": true,
        "protectedTools": []  // Tool names to exclude from dedup
    },

    // Error input purging: strip inputs from errored tool calls
    "purgeErrors": {
        "enabled": true,
        "turns": 4  // Not yet used (purges immediately); reserved for future turn-based logic
    },

    // Slash commands
    "commands": {
        "enabled": true
    },

    // Turn protection: protect recent tool outputs from trimming
    "turnProtection": {
        "enabled": true,
        "turns": 4   // Number of recent user turns to protect
    },

    // Glob patterns for files whose outputs should never be trimmed
    "protectedFilePatterns": []
}
```

### Customizing the prompt

To customize the compaction prompt, modify the `buildCompactionPrompt()` function in `src/prompt.ts`. The template is a plain string that you can edit to add or remove sections.

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests with coverage
bun run test:coverage

# The plugin is TypeScript — no build step needed for OpenCode
# (OpenCode loads .ts files directly via Bun)
```

Current coverage: **96.2% statements, 100% functions, 97.0% lines, 82.2% branches** (156 tests).

## File Structure

```
src/
  index.ts          — Plugin entry point, hooks, integration
  prompt.ts         — Compaction prompt template (11 sections)
  files-touched.ts  — File operation tracker with manifest renderer
  config.ts         — Config loading and defaults
  strategies.ts     — Dedup and error purge strategies
  glob.ts           — Glob matcher for protected file patterns
  compress.ts       — Compress tool definition and queue management
test/
  index.test.ts     — Plugin integration tests
  prompt.test.ts    — Prompt template tests
  files-touched.test.ts — File tracker tests
  config.test.ts    — Config loading tests
  strategies.test.ts — Strategy unit tests
  glob.test.ts      — Glob matcher tests
  compress.test.ts  — Compress tool tests
```

## Compatibility

- OpenCode >= 0.1.0 (with plugin support and `experimental.session.compacting` hook)
- The `experimental.*` hooks are marked experimental and may change in future OpenCode versions

## License

MIT
