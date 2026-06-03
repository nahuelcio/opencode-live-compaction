# opencode-live-compaction

Enhanced context compaction plugin for [OpenCode](https://opencode.ai) — structured summaries with files-touched manifests, task-state continuity, and a richer prompt template.

## What it does

OpenCode's built-in compaction produces a 7-section summary. This plugin replaces it with an **11-section structured summary** that preserves more context for seamless session continuation after compaction.

### Built-in vs opencode-live-compaction

| | OpenCode Built-in | opencode-live-compaction |
|---|---|---|
| **Summary sections** | 7 (Goal, Constraints, Progress, Decisions, Next Steps, Critical Context, Relevant Files) | **11** (Brief, User Intent Trail, Constraints, Errors/Dead Ends, Decisions, Status, Task Continuity, Open Issues, Next Steps, Mandatory Reading, Files Touched) |
| **User intent** | Captured as "Goal" | **Chronological intent trail** with direction changes |
| **Dead ends** | Not tracked | **Dedicated section** for failed approaches |
| **Task continuity** | Not captured | **Exact moment** where work stopped |
| **Files touched** | "Relevant Files" section | **Operation-badge manifest** (`R`=read, `E`=edit, `W`=write, `D`=delete) |
| **Prompt** | Hardcoded | Replaced via plugin hook (customizable) |

## Install

### Option 1: Local plugin (recommended)

Copy the source files to your project's plugin directory:

```bash
# Clone or download
git clone https://github.com/your-org/opencode-live-compaction.git

# Copy to your project
cp -r opencode-live-compaction/src/* .opencode/plugins/live-compaction/
```

Or create a single file at `.opencode/plugins/live-compaction.ts` with the combined code.

### Option 2: npm package

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-live-compaction"]
}
```

## How it works

The plugin hooks into three OpenCode plugin events:

### 1. `tool.execute.after` — Files tracking

Records every file operation (read, write, edit, delete) during the session. Produces a manifest like:

```
- `src/index.ts` `R` `E`
- `src/config.ts` `R` `W`
- `test/app.test.ts` `R`
```

### 2. `experimental.session.compacting` — Enhanced prompt

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

### 3. `experimental.compaction.autocontinue` — Auto-resume

Ensures the session continues automatically after compaction so work isn't interrupted.

## Configuration

No configuration needed — the plugin works out of the box.

### Customizing the prompt

To customize the compaction prompt, modify the `buildCompactionPrompt()` function in `src/prompt.ts`. The template is a plain string that you can edit to add or remove sections.

## Development

```bash
# Install dependencies
bun install

# The plugin is TypeScript — no build step needed for OpenCode
# (OpenCode loads .ts files directly via Bun)
```

## Compatibility

- OpenCode >= 0.1.0 (with plugin support and `experimental.session.compacting` hook)
- The `experimental.*` hooks are marked experimental and may change in future OpenCode versions

## License

MIT
