/**
 * opencode-live-compaction — Enhanced context compaction plugin for OpenCode.
 *
 * Features:
 * - 11-section structured summary (vs 7 built-in)
 * - Files-touched manifest with operation badges
 * - Focus directive support via session metadata
 * - Customizable prompt with context injection
 * - Auto-continue control after compaction
 * - Tool output trimming (configurable per-tool limits)
 * - Protected file patterns (never trim matching files)
 * - Turn protection (protect recent tool outputs from trimming)
 * - Deduplication of repeated tool calls
 * - Error input purging
 * - Slash commands: /compact, /compact:focus <directive>
 * - JSON config file support
 *
 * Usage:
 *   1. Local: copy to `.opencode/plugins/live-compaction.ts`
 *   2. npm: add "opencode-live-compaction" to `plugin` array in opencode.json
 */

import { buildCompactionPrompt } from "./prompt.js";
import { FilesTouchedTracker } from "./files-touched.js";
import { loadConfig, type LiveCompactionConfig } from "./config.js";
import { applyDedup, applyPurgeErrors } from "./strategies.js";
import { extractFilePaths, isFileProtected } from "./glob.js";
import {
	buildCompressToolDef,
	queueCompression,
	drainCompressions,
	applyCompressions,
	clearCompressions,
	clearAllCompressions,
} from "./compress.js";

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

interface MessagePart {
	type: string;
	tool?: string;
	callID?: string;
	state?: {
		status?: string;
		output?: string;
		input?: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

interface Message {
	info: { role: string; [key: string]: unknown };
	parts: MessagePart[];
}

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
		output: { messages: Message[] },
	) => Promise<void>;
	"command.execute.before"?: (
		input: { command: string; args: string },
		output: { handled: boolean; message?: string },
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

// Track which sessions have pending focus directives (set via /compact:focus)
const focusDirectives = new Map<string, string>();

// ---------------------------------------------------------------------------
// Tool output trimming (uses config limits + protected patterns + turn protection)
// ---------------------------------------------------------------------------

function buildTrimMap(config: LiveCompactionConfig): Record<string, number> {
	return {
		bash: config.trim?.bash ?? 600,
		write: config.trim?.write ?? 100,
		edit: config.trim?.edit ?? 100,
		delete: config.trim?.delete ?? 50,
		read: config.trim?.read ?? 300,
		glob: config.trim?.glob ?? 200,
		grep: config.trim?.grep ?? 400,
		list: config.trim?.list ?? 200,
	};
}

function trimToolOutput(
	toolName: string,
	output: string,
	trimMap: Record<string, number>,
	defaultLimit: number,
): string {
	const limit = trimMap[toolName] ?? defaultLimit;
	if (output.length <= limit) return output;

	const indicator = `\n... [trimmed ${output.length - limit}/${output.length} chars]`;
	// Keep the END of output (usually has the important result/error)
	return output.slice(-limit) + indicator;
}

/**
 * Count user message boundaries from the end of the messages array.
 * Returns a set of message indices that fall within the last N user turns.
 */
function getRecentTurnIndices(
	messages: Message[],
	protectedTurns: number,
): Set<number> {
	const recentIndices = new Set<number>();
	let userTurnsFromEnd = 0;

	// Walk backwards from the end
	for (let i = messages.length - 1; i >= 0; i--) {
		recentIndices.add(i);

		if (messages[i].info.role === "user") {
			userTurnsFromEnd++;
			if (userTurnsFromEnd >= protectedTurns) {
				break;
			}
		}
	}

	return recentIndices;
}

/**
 * Check if a tool part's args contain a file path matching protected patterns.
 */
function hasProtectedFilePath(
	part: MessagePart,
	protectedPatterns: string[],
): boolean {
	if (protectedPatterns.length === 0) return false;

	const args = (part as Record<string, unknown>).args;
	if (typeof args !== "object" || args === null) return false;

	const paths = extractFilePaths(
		part.tool ?? "",
		args as Record<string, unknown>,
	);
	return isFileProtected(paths, protectedPatterns);
}

// ---------------------------------------------------------------------------
// Logger helper
// ---------------------------------------------------------------------------

function makeLogger(client: PluginInput["client"], enabled: boolean) {
	return {
		info: (msg: string, data?: unknown) => {
			if (enabled) {
				client.app.log(
					`[live-compaction] ${msg}${data ? " " + JSON.stringify(data) : ""}`,
				);
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const LiveCompactionPlugin: Plugin = async (ctx) => {
	// Load config from project directory
	const config = loadConfig(ctx.directory);
	const logger = makeLogger(ctx.client, config.debug ?? false);

	// Build trim limits map once
	const trimMap = buildTrimMap(config);
	const defaultTrim = config.trim?.default ?? 500;
	const protectedPatterns = config.protectedFilePatterns ?? [];
	const turnProtectionEnabled = config.turnProtection?.enabled ?? true;
	const protectedTurns = config.turnProtection?.turns ?? 4;

	logger.info("initialized", {
		dedup: config.dedup?.enabled,
		purgeErrors: config.purgeErrors?.enabled,
		commands: config.commands?.enabled,
		protectedPatterns: protectedPatterns.length,
		turnProtection: turnProtectionEnabled ? protectedTurns : "off",
	});

	return {
		// -----------------------------------------------------------------------
		// Track file operations + capture compress tool calls
		// -----------------------------------------------------------------------
		"tool.execute.after": async (input, _output) => {
			const { tool, sessionID, args } = input;
			if (!sessionID || !args) return;

			// Track file operations
			const tracker = getTracker(sessionID);
			tracker.processToolCall(tool, args as Record<string, unknown>);

			// Capture compress tool calls
			if (tool === "compress") {
				const a = args as Record<string, unknown>;
				if (
					typeof a.topic === "string" &&
					typeof a.start === "number" &&
					typeof a.end === "number" &&
					typeof a.summary === "string"
				) {
					queueCompression(sessionID, {
						topic: a.topic,
						start: a.start,
						end: a.end,
						summary: a.summary,
						timestamp: Date.now(),
					});
					logger.info("compress queued", {
						sessionID,
						topic: a.topic,
						range: `${a.start}-${a.end}`,
					});
				}
			}
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

			// Check for pending focus directive (from /compact:focus)
			const focus = focusDirectives.get(sessionID);
			if (focus) {
				focusDirectives.delete(sessionID);
			}

			// Build the enhanced prompt
			const enhancedPrompt = buildCompactionPrompt({
				filesTouched: filesManifest,
				focusDirective: focus,
			});

			// Replace the default compaction prompt entirely
			output.prompt = enhancedPrompt;

			logger.info("compaction triggered", {
				sessionID,
				hasFiles: !!filesManifest,
				hasFocus: !!focus,
			});
		},

		// -----------------------------------------------------------------------
		// Compress + trim + dedup + purge + protected patterns + turn protection
		// Runs BEFORE OpenCode's own 2000-char truncation.
		// -----------------------------------------------------------------------
		"experimental.chat.messages.transform": async (_input, output) => {
			const messages = output.messages;

			// 0. Apply pending compressions (from compress tool calls)
			// We need the sessionID but the transform hook doesn't provide it.
			// Since compressions are rare, we check all sessions.
			for (const [sid] of sessionTrackers) {
				const requests = drainCompressions(sid);
				if (requests.length > 0) {
					const replaced = applyCompressions(
						messages as Parameters<typeof applyCompressions>[0],
						requests,
					);
					if (replaced > 0) {
						logger.info("compress applied", {
							sessionID: sid,
							messagesReplaced: replaced,
						});
					}
				}
			}

			// 1. Compute turn-protected indices (messages within last N user turns)
			const recentIndices = turnProtectionEnabled
				? getRecentTurnIndices(messages, protectedTurns)
				: new Set<number>();

			// 2. Trim tool outputs with protection checks
			for (let mi = 0; mi < messages.length; mi++) {
				const msg = messages[mi];
				for (const part of msg.parts) {
					if (
						part.type !== "tool" ||
						!part.state ||
						typeof part.state.output !== "string" ||
						!part.tool
					) {
						continue;
					}

					// Skip if within protected turn window
					if (recentIndices.has(mi)) continue;

					// Skip if file path matches protected patterns
					if (hasProtectedFilePath(part, protectedPatterns)) continue;

					part.state.output = trimToolOutput(
						part.tool,
						part.state.output,
						trimMap,
						defaultTrim,
					);
				}
			}

			// 3. Dedup repeated tool calls
			if (config.dedup?.enabled) {
				const deduped = applyDedup(
					messages as Parameters<typeof applyDedup>[0],
					config,
				);
				if (deduped > 0) {
					logger.info("dedup applied", { count: deduped });
				}
			}

			// 4. Purge errored tool inputs
			if (config.purgeErrors?.enabled) {
				const purged = applyPurgeErrors(
					messages as Parameters<typeof applyPurgeErrors>[0],
					config,
				);
				if (purged > 0) {
					logger.info("error purge applied", { count: purged });
				}
			}
		},

		// -----------------------------------------------------------------------
		// Slash commands: /compact and /compact:focus <directive>
		// -----------------------------------------------------------------------
		"command.execute.before": async (input, output) => {
			if (!config.commands?.enabled) return;

			const { command, args } = input;

			if (command === "compact") {
				const focusMatch = args?.match(/^focus\s+(\S.+)$/i);
				if (focusMatch) {
					const directive = focusMatch[1].trim();
					for (const [sid] of sessionTrackers) {
						focusDirectives.set(sid, directive);
					}
					output.handled = true;
					output.message = `Focus directive set: "${directive}"\nWill be applied on next compaction.`;
					logger.info("focus directive set", { directive });
				} else {
					output.handled = false;
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
					focusDirectives.delete(props.sessionID);
					clearCompressions(props.sessionID);
				}
			}
		},

		// -----------------------------------------------------------------------
		// Dispose: clean up all state
		// -----------------------------------------------------------------------
		dispose: async () => {
			sessionTrackers.clear();
			focusDirectives.clear();
			clearAllCompressions();
		},

		// -----------------------------------------------------------------------
		// Config: register compress tool + slash commands with OpenCode
		// -----------------------------------------------------------------------
		config: async (opencodeConfig: Record<string, unknown>) => {
			// Register compress tool if permission allows
			const permission = opencodeConfig.permission as
				| Record<string, unknown>
				| undefined;
			if (!permission || permission.compress !== "deny") {
				opencodeConfig.permission = {
					...(permission ?? {}),
					compress: "allow",
				};
			}

			// Register slash commands
			if (config.commands?.enabled) {
				const existing = opencodeConfig.command as
					| Record<string, unknown>
					| undefined;
				opencodeConfig.command = {
					...(existing ?? {}),
					compact: {
						template: "",
						description:
							"Trigger compaction. Use /compact:focus <directive> to set a focus goal.",
					},
				};
			}
		},

		// -----------------------------------------------------------------------
		// Compress tool definition
		// -----------------------------------------------------------------------
		tool: buildCompressToolDef(),
	} as Hooks;
};

export default LiveCompactionPlugin;
