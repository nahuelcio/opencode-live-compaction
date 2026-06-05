/**
 * Context optimization strategies for opencode-live-compaction.
 *
 * - Deduplication: removes duplicate tool calls (same tool + same args), keeping only the latest.
 * - Error purge: strips input content from errored tool calls after N turns.
 *
 * Both strategies operate on the messages array in experimental.chat.messages.transform.
 */

import type { LiveCompactionConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface StrategyContext {
	/** The config for this session */
	config: LiveCompactionConfig;
	/** Per-session turn counter (incremented per message transform) */
	turnCounter: Map<string, number>;
	/** Session ID for turn tracking (set from the transform hook) */
	sessionId?: string;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Build a stable hash key for a tool call (tool name + serialized args).
 * Uses JSON.stringify with sorted keys for determinism.
 */
export function toolCallKey(tool: string, args: unknown): string {
	const sorted =
		typeof args === "object" && args !== null
			? sortKeys(args as Record<string, unknown>)
			: args;
	return `${tool}::${JSON.stringify(sorted)}`;
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj).sort()) {
		const val = obj[key];
		sorted[key] =
			typeof val === "object" && val !== null && !Array.isArray(val)
				? sortKeys(val as Record<string, unknown>)
				: val;
	}
	return sorted;
}

/**
 * Deduplicate tool calls in the messages array.
 *
 * For each (tool, args) pair, only the LAST occurrence is kept.
 * Earlier duplicates have their output replaced with a short marker.
 * Protected tools (in config) are never deduped.
 */
export function applyDedup(
	messages: Message[],
	config: LiveCompactionConfig,
): number {
	if (!config.dedup?.enabled) return 0;

	const protectedTools = new Set(config.dedup.protectedTools ?? []);

	// Collect all tool call keys and their positions (in order)
	const seen = new Map<string, { msgIdx: number; partIdx: number }[]>();

	for (let mi = 0; mi < messages.length; mi++) {
		const msg = messages[mi];
		for (let pi = 0; pi < msg.parts.length; pi++) {
			const part = msg.parts[pi];
			if (part.type !== "tool" || !part.tool) continue;
			if (protectedTools.has(part.tool)) continue;

			const args = (part as Record<string, unknown>).args ?? part.state?.input;
			const key = toolCallKey(part.tool, args);

			if (!seen.has(key)) seen.set(key, []);
			seen.get(key)!.push({ msgIdx: mi, partIdx: pi });
		}
	}

	let deduped = 0;

	for (const [_key, positions] of seen) {
		if (positions.length <= 1) continue;

		// Keep the last occurrence, replace earlier ones with a marker
		for (let i = 0; i < positions.length - 1; i++) {
			const { msgIdx, partIdx } = positions[i];
			const part = messages[msgIdx].parts[partIdx];
			if (part.state) {
				const originalLen = (part.state.output ?? "").length;
				part.state.output = `[deduped: same call as later ${part.tool} output — ${originalLen} chars removed]`;
			}
			deduped++;
		}
	}

	return deduped;
}

// ---------------------------------------------------------------------------
// Error Purge
// ---------------------------------------------------------------------------

/**
 * Find tool parts that returned errors and whose input should be purged.
 * Returns indices of parts whose input will be stripped.
 */
export function findErroredParts(
	messages: Message[],
): { msgIdx: number; partIdx: number }[] {
	const errored: { msgIdx: number; partIdx: number }[] = [];

	for (let mi = 0; mi < messages.length; mi++) {
		const msg = messages[mi];
		for (let pi = 0; pi < msg.parts.length; pi++) {
			const part = msg.parts[pi];
			if (part.type !== "tool" || !part.state) continue;

			const status = part.state.status;
			if (status === "error" || status === "failed") {
				errored.push({ msgIdx: mi, partIdx: pi });
			}
		}
	}

	return errored;
}

/**
 * Strip the input content from errored tool calls.
 * The error output is preserved; only the potentially large input is removed.
 * Returns the number of parts purged.
 */
export function applyPurgeErrors(
	messages: Message[],
	config: LiveCompactionConfig,
): number {
	if (!config.purgeErrors?.enabled) return 0;

	const erroredParts = findErroredParts(messages);
	let purged = 0;

	for (const { msgIdx, partIdx } of erroredParts) {
		const part = messages[msgIdx].parts[partIdx];
		if (part.state?.input && typeof part.state.input === "string") {
			const inputLen = part.state.input.length;
			if (inputLen > 100) {
				part.state.input = `[purged: ${inputLen} chars of errored input removed]`;
				purged++;
			}
		}
	}

	return purged;
}
