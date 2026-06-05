/**
 * Compress tool for opencode-live-compaction.
 *
 * Exposes a "compress" tool to the model that replaces a range of messages
 * with a summary written by the model itself. The model has full context,
 * so it can write high-quality summaries. The plugin handles the mechanical
 * replacement in the messages array.
 *
 * Flow:
 *   1. Model calls compress({ topic, start, end, summary })
 *   2. Tool stores the pending compression request
 *   3. On next message transform, the range is replaced with a synthetic
 *      summary message
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressRequest {
	/** Topic label for the compression (3-5 words) */
	topic: string;
	/** Start message index (inclusive, 0-based) */
	start: number;
	/** End message index (inclusive, 0-based) */
	end: number;
	/** Summary text written by the model */
	summary: string;
	/** Timestamp for ordering */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Pending compressions storage (per-session)
// ---------------------------------------------------------------------------

const pendingCompressions = new Map<string, CompressRequest[]>();

/**
 * Queue a compression request for a session.
 */
export function queueCompression(
	sessionID: string,
	request: CompressRequest,
): void {
	let queue = pendingCompressions.get(sessionID);
	if (!queue) {
		queue = [];
		pendingCompressions.set(sessionID, queue);
	}
	queue.push(request);
}

/**
 * Get and clear pending compressions for a session.
 */
export function drainCompressions(sessionID: string): CompressRequest[] {
	const queue = pendingCompressions.get(sessionID) ?? [];
	pendingCompressions.delete(sessionID);
	return queue.sort((a, b) => b.start - a.start); // Process from end to start
}

/**
 * Clear all pending compressions for a session.
 */
export function clearCompressions(sessionID: string): void {
	pendingCompressions.delete(sessionID);
}

/**
 * Clear all pending compressions (for dispose).
 */
export function clearAllCompressions(): void {
	pendingCompressions.clear();
}

// ---------------------------------------------------------------------------
// Compression application
// ---------------------------------------------------------------------------

interface Message {
	info: { role: string; id?: string; [key: string]: unknown };
	parts: Array<{
		type: string;
		text?: string;
		tool?: string;
		[key: string]: unknown;
	}>;
}

/**
 * Apply pending compressions to a messages array.
 * Processes from end to start to keep indices stable.
 *
 * Returns the number of messages replaced.
 */
export function applyCompressions(
	messages: Message[],
	requests: CompressRequest[],
): number {
	if (requests.length === 0) return 0;

	let totalReplaced = 0;

	for (const req of requests) {
		const start = Math.max(0, req.start);
		const end = Math.min(messages.length - 1, req.end);

		if (start > end || start >= messages.length) continue;

		// Count how many messages we're replacing
		const count = end - start + 1;

		// Create a synthetic summary message
		const summaryMessage: Message = {
			info: { role: "user" },
			parts: [
				{
					type: "text",
					text: `<compressed-block topic="${escapeAttr(req.topic)}" range="${start}-${end}" count="${count}">\n${req.summary}\n</compressed-block>`,
				},
			],
		};

		// Replace the range with the summary
		messages.splice(start, count, summaryMessage);
		totalReplaced += count;
	}

	return totalReplaced;
}

function escapeAttr(s: string): string {
	return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Tool definition (for OpenCode plugin API)
// ---------------------------------------------------------------------------

/**
 * Build the compress tool description and handler.
 * Returns the tool config to be spread into the plugin's `tool` object.
 */
export function buildCompressToolDef() {
	return {
		description: `Compress a range of conversation messages into a summary.

Use this tool when you have completed a task phase and want to reduce context size.
You write the summary — you have the full context. Be thorough but concise.

The compressed range will be replaced with your summary in the conversation.
Message indices are 0-based. Use the message order visible in the conversation.`,
		args: {
			topic: {
				type: "string",
				description:
					"Short label (3-5 words) for display, e.g., 'Auth Bug Fix'",
			},
			start: {
				type: "number",
				description: "Start message index (inclusive, 0-based)",
			},
			end: {
				type: "number",
				description: "End message index (inclusive, 0-based)",
			},
			summary: {
				type: "string",
				description:
					"Complete technical summary replacing all messages in the range. Include file paths, decisions, error strings, and code snippets that are still relevant.",
			},
		},
	};
}
