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
