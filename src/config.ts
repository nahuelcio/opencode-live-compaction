/**
 * Configuration for opencode-live-compaction.
 *
 * Loads from .opencode/live-compaction.json (project) or falls back to defaults.
 * All fields are optional — missing keys use sensible defaults.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrimLimits {
	/** Max chars for bash/shell outputs (default: 600) */
	bash?: number;
	/** Max chars for write confirmations (default: 100) */
	write?: number;
	/** Max chars for edit confirmations (default: 100) */
	edit?: number;
	/** Max chars for delete confirmations (default: 50) */
	delete?: number;
	/** Max chars for file reads (default: 300) */
	read?: number;
	/** Max chars for file listings (default: 200) */
	glob?: number;
	/** Max chars for search results (default: 400) */
	grep?: number;
	/** Max chars for directory listings (default: 200) */
	list?: number;
	/** Default max chars for unlisted tools (default: 500) */
	default?: number;
}

export interface DedupConfig {
	/** Enable deduplication of repeated tool calls (default: true) */
	enabled?: boolean;
	/** Tool names to exclude from dedup (default: []) */
	protectedTools?: string[];
}

export interface PurgeErrorsConfig {
	/** Enable purging errored tool inputs (default: true) */
	enabled?: boolean;
	/** Number of turns after which to purge error inputs (default: 4) */
	turns?: number;
}

export interface SlashCommandsConfig {
	/** Enable slash commands (default: true) */
	enabled?: boolean;
}

export interface TurnProtectionConfig {
	/** Enable turn-based protection (default: true) */
	enabled?: boolean;
	/** Number of recent turns whose tool outputs are protected from trimming (default: 4) */
	turns?: number;
}

export interface LiveCompactionConfig {
	/** Enable/disable the entire plugin (default: true) */
	enabled?: boolean;
	/** Tool output trim limits by tool name */
	trim?: TrimLimits;
	/** Deduplication strategy */
	dedup?: DedupConfig;
	/** Error input purging strategy */
	purgeErrors?: PurgeErrorsConfig;
	/** Slash commands */
	commands?: SlashCommandsConfig;
	/** Turn-based protection: protect recent tool outputs from trimming */
	turnProtection?: TurnProtectionConfig;
	/** Glob patterns for files whose tool outputs should never be trimmed (default: []) */
	protectedFilePatterns?: string[];
	/** Enable debug logging (default: false) */
	debug?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TRIM: Required<TrimLimits> = {
	bash: 600,
	write: 100,
	edit: 100,
	delete: 50,
	read: 300,
	glob: 200,
	grep: 400,
	list: 200,
	default: 500,
};

export const DEFAULT_CONFIG: Required<
	Omit<
		LiveCompactionConfig,
		"trim" | "dedup" | "purgeErrors" | "commands" | "turnProtection"
	>
> & {
	trim: Required<TrimLimits>;
	dedup: Required<DedupConfig>;
	purgeErrors: Required<PurgeErrorsConfig>;
	commands: Required<SlashCommandsConfig>;
	turnProtection: Required<TurnProtectionConfig>;
} = {
	enabled: true,
	debug: false,
	trim: { ...DEFAULT_TRIM },
	dedup: {
		enabled: true,
		protectedTools: [],
	},
	purgeErrors: {
		enabled: true,
		turns: 4,
	},
	commands: {
		enabled: true,
	},
	turnProtection: {
		enabled: true,
		turns: 4,
	},
	protectedFilePatterns: [],
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const CONFIG_FILE_NAMES = ["live-compaction.json", "live-compaction.jsonc"];

/**
 * Load config from a project directory. Searches for:
 *   <projectDir>/.opencode/live-compaction.json
 *   <projectDir>/.opencode/live-compaction.jsonc
 *
 * Returns merged config (user values override defaults).
 * Returns defaults if no config file is found.
 */
export function loadConfig(projectDir: string): ReturnType<typeof mergeConfig> {
	const dotDir = join(projectDir, ".opencode");

	for (const name of CONFIG_FILE_NAMES) {
		const configPath = join(dotDir, name);
		if (existsSync(configPath)) {
			try {
				const raw = readFileSync(configPath, "utf-8");
				// Strip JSONC comments (// and /* */) for .jsonc support
				const stripped = stripJsonComments(raw);
				const parsed = JSON.parse(stripped) as LiveCompactionConfig;
				return mergeConfig(parsed);
			} catch {
				// Fall through to defaults on parse error
			}
		}
	}

	return mergeConfig({});
}

/**
 * Merge user config over defaults. Deep-merges nested objects.
 */
export function mergeConfig(user: LiveCompactionConfig) {
	return {
		enabled: user.enabled ?? DEFAULT_CONFIG.enabled,
		debug: user.debug ?? DEFAULT_CONFIG.debug,
		trim: { ...DEFAULT_CONFIG.trim, ...user.trim },
		dedup: {
			enabled: user.dedup?.enabled ?? DEFAULT_CONFIG.dedup.enabled,
			protectedTools:
				user.dedup?.protectedTools ?? DEFAULT_CONFIG.dedup.protectedTools,
		},
		purgeErrors: {
			enabled: user.purgeErrors?.enabled ?? DEFAULT_CONFIG.purgeErrors.enabled,
			turns: user.purgeErrors?.turns ?? DEFAULT_CONFIG.purgeErrors.turns,
		},
		commands: {
			enabled: user.commands?.enabled ?? DEFAULT_CONFIG.commands.enabled,
		},
		turnProtection: {
			enabled:
				user.turnProtection?.enabled ?? DEFAULT_CONFIG.turnProtection.enabled,
			turns: user.turnProtection?.turns ?? DEFAULT_CONFIG.turnProtection.turns,
		},
		protectedFilePatterns:
			user.protectedFilePatterns ?? DEFAULT_CONFIG.protectedFilePatterns,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip single-line and block comments from JSONC strings. */
function stripJsonComments(json: string): string {
	// Remove single-line comments (// ...) not inside strings
	let result = "";
	let inString = false;
	let escape = false;

	for (let i = 0; i < json.length; i++) {
		const ch = json[i];

		if (escape) {
			result += ch;
			escape = false;
			continue;
		}

		if (ch === "\\" && inString) {
			result += ch;
			escape = true;
			continue;
		}

		if (ch === '"') {
			inString = !inString;
			result += ch;
			continue;
		}

		if (inString) {
			result += ch;
			continue;
		}

		// Not in string — check for comments
		if (ch === "/" && i + 1 < json.length) {
			if (json[i + 1] === "/") {
				// Single-line comment: skip to end of line
				while (i < json.length && json[i] !== "\n") i++;
				result += "\n";
				continue;
			}
			if (json[i + 1] === "*") {
				// Block comment: skip to */
				i += 2;
				while (
					i + 1 < json.length &&
					!(json[i] === "*" && json[i + 1] === "/")
				) {
					i++;
				}
				i++; // skip the /
				continue;
			}
		}

		result += ch;
	}

	return result;
}
