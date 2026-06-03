/**
 * opencode-live-compaction — Enhanced context compaction plugin for OpenCode.
 *
 * Features:
 * - 11-section structured summary (vs 7 built-in)
 * - Files-touched manifest with operation badges
 * - Focus directive support via session metadata
 * - Customizable prompt with context injection
 * - Auto-continue control after compaction
 *
 * Usage:
 *   1. Local: copy to `.opencode/plugins/live-compaction.ts`
 *   2. npm: add "opencode-live-compaction" to `plugin` array in opencode.json
 */

import { buildCompactionPrompt } from "./prompt.js";
import { FilesTouchedTracker } from "./files-touched.js";

// ---------------------------------------------------------------------------
// Types — inlined from @opencode-ai/plugin to avoid requiring it as a dep.
// These match the Hooks interface and Plugin type at runtime.
// ---------------------------------------------------------------------------

interface PluginInput {
	client: { app: { log: (input: unknown) => Promise<void> } };
	project: { id: string; name: string };
	directory: string;
	worktree: string;
	serverUrl: URL;
}

type Plugin = (
	input: PluginInput,
	options?: Record<string, unknown>,
) => Promise<Hooks>;

interface Hooks {
	dispose?: () => Promise<void>;
	event?: (input: {
		event: { id: string; type: string; properties: unknown };
	}) => Promise<void>;
	"tool.execute.after"?: (
		input: { tool: string; sessionID: string; callID: string; args: unknown },
		output: { title: string; output: string; metadata: unknown },
	) => Promise<void>;
	"experimental.session.compacting"?: (
		input: { sessionID: string },
		output: { context: string[]; prompt?: string },
	) => Promise<void>;
	"experimental.compaction.autocontinue"?: (
		input: Record<string, unknown>,
		output: { enabled: boolean },
	) => Promise<void>;
	"experimental.chat.messages.transform"?: (
		input: Record<string, unknown>,
		output: {
			messages: Array<{
				info: { role: string; [key: string]: unknown };
				parts: Array<{
					type: string;
					tool?: string;
					state?: { output?: string; [key: string]: unknown };
					[key: string]: unknown;
				}>;
			}>;
		},
	) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Per-session state
// ---------------------------------------------------------------------------

const sessionTrackers = new Map<string, FilesTouchedTracker>();

function getTracker(sessionID: string): FilesTouchedTracker {
	let tracker = sessionTrackers.get(sessionID);
	if (!tracker) {
		tracker = new FilesTouchedTracker();
		sessionTrackers.set(sessionID, tracker);
	}
	return tracker;
}

// ---------------------------------------------------------------------------
// Tool output trimming for compaction
// ---------------------------------------------------------------------------

/** Max chars to keep per tool output type during compaction */
const TOOL_TRIM: Record<string, number> = {
	bash: 600,        // shell outputs (logs, test runs) — keep last 600 chars
	write: 100,       // file write confirmations — minimal
	edit: 100,        // edit confirmations — minimal
	delete: 50,       // delete confirmations — minimal
	read: 300,        // file reads — keep snippet
	glob: 200,        // file listings
	grep: 400,        // search results
	list: 200,        // directory listings
};

const DEFAULT_TOOL_TRIM = 500;

function trimToolOutput(toolName: string, output: string): string {
	const limit = TOOL_TRIM[toolName] ?? DEFAULT_TOOL_TRIM;
	if (output.length <= limit) return output;

	const indicator = `\n... [trimmed ${output.length - limit}/${output.length} chars]`;
	// Keep the END of output (usually has the important result/error)
	return output.slice(-limit) + indicator;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const LiveCompactionPlugin: Plugin = async (_ctx) => {
	return {
		// -----------------------------------------------------------------------
		// Track file operations across the session
		// -----------------------------------------------------------------------
		"tool.execute.after": async (input, _output) => {
			const { tool, sessionID, args } = input;
			if (!sessionID || !args) return;

			const tracker = getTracker(sessionID);
			tracker.processToolCall(tool, args as Record<string, unknown>);
		},

		// -----------------------------------------------------------------------
		// Enhanced compaction: replace the default prompt with our structured one
		// -----------------------------------------------------------------------
		"experimental.session.compacting": async (input, output) => {
			const { sessionID } = input;

			// Collect files-touched manifest
			const tracker = getTracker(sessionID);
			const filesManifest =
				tracker.size > 0 ? tracker.renderManifest() : undefined;

			// Clear tracker after compaction since old operations are now in the summary
			tracker.clear();

			// Build the enhanced prompt
			const enhancedPrompt = buildCompactionPrompt({
				filesTouched: filesManifest,
			});

			// Replace the default compaction prompt entirely
			output.prompt = enhancedPrompt;
		},

		// -----------------------------------------------------------------------
		// Trim tool outputs before compaction to save context tokens
		// Runs BEFORE OpenCode's own 2000-char truncation, so we trim first.
		// -----------------------------------------------------------------------
		"experimental.chat.messages.transform": async (_input, output) => {
			for (const msg of output.messages) {
				for (const part of msg.parts) {
					if (
						part.type === "tool" &&
						part.state &&
						typeof part.state.output === "string" &&
						part.tool
					) {
						part.state.output = trimToolOutput(part.tool, part.state.output);
					}
				}
			}
		},

		// -----------------------------------------------------------------------
		// Auto-continue: always enable after compaction to keep the session flowing
		// -----------------------------------------------------------------------
		"experimental.compaction.autocontinue": async (_input, output) => {
			output.enabled = true;
		},

		// -----------------------------------------------------------------------
		// Cleanup on session events
		// -----------------------------------------------------------------------
		event: async ({ event }) => {
			if (event.type === "session.deleted") {
				const props = event.properties as { sessionID?: string } | undefined;
				if (props?.sessionID) {
					sessionTrackers.delete(props.sessionID);
				}
			}
		},

		// -----------------------------------------------------------------------
		// Dispose: clean up all trackers
		// -----------------------------------------------------------------------
		dispose: async () => {
			sessionTrackers.clear();
		},
	};
};

export default LiveCompactionPlugin;
