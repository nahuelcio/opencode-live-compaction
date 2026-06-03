/**
 * Enhanced compaction prompt template for opencode-live-compaction.
 *
 * Produces a structured summary with 11 continuity sections, inspired by
 * pi-live-compaction but adapted for OpenCode's plugin hook system.
 *
 * The prompt is designed to be set as `output.prompt` in the
 * `experimental.session.compacting` hook.
 */

export function buildCompactionPrompt(input: {
	filesTouched?: string;
	focusDirective?: string;
}): string {
	const filesBlock = input.filesTouched
		? `\n\n## Files Touched\n${input.filesTouched}`
		: "";

	const focusBlock = input.focusDirective
		? `\n\n<focus-directive>\nThe operator explicitly requested preserving this goal through compaction:\n${input.focusDirective}\n</focus-directive>`
		: "";

	return `You are an anchored context summarization assistant for coding sessions.

Summarize ONLY the conversation history you are given. The newest turns may be kept verbatim outside your summary, so focus on the older context that still matters for continuing the work.

If the prompt includes a <previous-summary> block, treat it as the current anchored summary. Update it with the new history by preserving still-true details, removing stale details, and merging in new facts.

${focusBlock}

Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.

<template>
## Brief
- [1-2 sentence executive summary of the session state]

## User Intent Trail
- [chronological list of what the user asked for, with exact quotes when they changed direction]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Errors & Dead Ends
- [approaches tried that failed, with error strings and why they didn't work, or "(none)"]

## Key Decisions
- [decision and why it was made, or "(none)"]

## Status
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Task Continuity
- [what the agent was actively doing when compaction triggered, files open, commands pending]

## Open Issues & Questions
- [unresolved issues, questions needing user input, or "(none)"]

## Next Steps
- [ordered next actions to resume work]

## Mandatory Reading
- [files or paths that MUST be read first to resume context, or "(none)"]
${filesBlock}
</template>

Rules:
- Keep every section, even when empty — use "(none)" as placeholder.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers.
- Do NOT mention the summary process or that context was compacted.
- Respond in the same language as the conversation.
- The "User Intent Trail" must capture chronological changes in direction with quote fidelity.
- The "Task Continuity" section must describe the exact moment where work stopped so the next agent can resume seamlessly.
- The "Mandatory Reading" section must list files that hold critical state (e.g., partially edited files, config files being modified, test files being fixed).`;
}

/**
 * System prompt for the compaction summarizer.
 * This is sent as the system message alongside the user prompt.
 */
export const COMPACTION_SYSTEM_PROMPT = `You are an expert context summarizer for AI coding sessions. Your summaries preserve every detail needed for seamless continuation after context compaction. You never mention compaction or summarization in your output.`;
