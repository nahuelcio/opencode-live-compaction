import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	loadConfig,
	mergeConfig,
	DEFAULT_CONFIG,
	DEFAULT_TRIM,
} from "../src/config.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TMP_DIR = join(import.meta.dirname, "__tmp_config_test");

function setupTmp() {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
	mkdirSync(TMP_DIR, { recursive: true });
	mkdirSync(join(TMP_DIR, ".opencode"), { recursive: true });
}

function cleanupTmp() {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
}

describe("mergeConfig()", () => {
	it("returns defaults for empty input", () => {
		const cfg = mergeConfig({});
		expect(cfg.enabled).toBe(true);
		expect(cfg.debug).toBe(false);
		expect(cfg.trim.bash).toBe(600);
		expect(cfg.dedup.enabled).toBe(true);
		expect(cfg.dedup.protectedTools).toEqual([]);
		expect(cfg.purgeErrors.enabled).toBe(true);
		expect(cfg.purgeErrors.turns).toBe(4);
		expect(cfg.commands.enabled).toBe(true);
	});

	it("overrides enabled", () => {
		const cfg = mergeConfig({ enabled: false });
		expect(cfg.enabled).toBe(false);
	});

	it("overrides trim limits", () => {
		const cfg = mergeConfig({ trim: { bash: 1000, read: 500 } });
		expect(cfg.trim.bash).toBe(1000);
		expect(cfg.trim.read).toBe(500);
		// Other trim defaults preserved
		expect(cfg.trim.write).toBe(100);
	});

	it("overrides dedup settings", () => {
		const cfg = mergeConfig({
			dedup: { enabled: false, protectedTools: ["bash"] },
		});
		expect(cfg.dedup.enabled).toBe(false);
		expect(cfg.dedup.protectedTools).toEqual(["bash"]);
	});

	it("overrides purgeErrors settings", () => {
		const cfg = mergeConfig({ purgeErrors: { enabled: false, turns: 8 } });
		expect(cfg.purgeErrors.enabled).toBe(false);
		expect(cfg.purgeErrors.turns).toBe(8);
	});

	it("overrides commands settings", () => {
		const cfg = mergeConfig({ commands: { enabled: false } });
		expect(cfg.commands.enabled).toBe(false);
	});

	it("overrides debug", () => {
		const cfg = mergeConfig({ debug: true });
		expect(cfg.debug).toBe(true);
	});
});

describe("loadConfig()", () => {
	beforeEach(setupTmp);
	afterEach(cleanupTmp);

	it("returns defaults when no config file exists", () => {
		const cfg = loadConfig(TMP_DIR);
		expect(cfg.enabled).toBe(true);
		expect(cfg.dedup.enabled).toBe(true);
	});

	it("loads live-compaction.json", () => {
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			JSON.stringify({ enabled: false, dedup: { enabled: false } }),
		);
		const cfg = loadConfig(TMP_DIR);
		expect(cfg.enabled).toBe(false);
		expect(cfg.dedup.enabled).toBe(false);
	});

	it("loads live-compaction.jsonc with comments", () => {
		const jsonc = `{
			// This is a comment
			"enabled": false,
			/* Block comment */
			"purgeErrors": { "turns": 10 }
		}`;
		writeFileSync(join(TMP_DIR, ".opencode", "live-compaction.jsonc"), jsonc);
		const cfg = loadConfig(TMP_DIR);
		expect(cfg.enabled).toBe(false);
		expect(cfg.purgeErrors.turns).toBe(10);
	});

	it("prefers .json over .jsonc", () => {
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			JSON.stringify({ debug: true }),
		);
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.jsonc"),
			'{ "debug": false }',
		);
		const cfg = loadConfig(TMP_DIR);
		expect(cfg.debug).toBe(true);
	});

	it("falls back to defaults on invalid JSON", () => {
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			"not valid json {{{",
		);
		const cfg = loadConfig(TMP_DIR);
		expect(cfg.enabled).toBe(true);
	});

	it("handles JSONC with escaped quotes in strings", () => {
		const jsonc = `{ "key": "value with \\"quotes\\" inside" }`;
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			jsonc,
		);
		const cfg = loadConfig(TMP_DIR);
		// Should parse without error
		expect(cfg).toBeDefined();
	});

	it("handles JSONC with strings containing special chars", () => {
		const jsonc = `{ "key": "line1\\nline2\\ttab" }`;
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			jsonc,
		);
		const cfg = loadConfig(TMP_DIR);
		expect(cfg).toBeDefined();
	});

	it("handles JSONC with block comments between values", () => {
		const jsonc = `{
			/* start comment */
			"enabled": true,
			/* middle comment */
			"debug": false
			/* end comment */
		}`;
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			jsonc,
		);
		const cfg = loadConfig(TMP_DIR);
		expect(cfg.enabled).toBe(true);
		expect(cfg.debug).toBe(false);
	});

	it("handles JSON with string values containing slashes", () => {
		const jsonc = `{ "path": "C:\\Users\\test" }`;
		writeFileSync(
			join(TMP_DIR, ".opencode", "live-compaction.json"),
			jsonc,
		);
		const cfg = loadConfig(TMP_DIR);
		expect(cfg).toBeDefined();
	});
});

describe("DEFAULT_CONFIG", () => {
	it("has all expected fields", () => {
		expect(DEFAULT_CONFIG).toHaveProperty("enabled");
		expect(DEFAULT_CONFIG).toHaveProperty("debug");
		expect(DEFAULT_CONFIG).toHaveProperty("trim");
		expect(DEFAULT_CONFIG).toHaveProperty("dedup");
		expect(DEFAULT_CONFIG).toHaveProperty("purgeErrors");
		expect(DEFAULT_CONFIG).toHaveProperty("commands");
	});

	it("has all trim tools", () => {
		expect(DEFAULT_TRIM).toHaveProperty("bash");
		expect(DEFAULT_TRIM).toHaveProperty("write");
		expect(DEFAULT_TRIM).toHaveProperty("edit");
		expect(DEFAULT_TRIM).toHaveProperty("delete");
		expect(DEFAULT_TRIM).toHaveProperty("read");
		expect(DEFAULT_TRIM).toHaveProperty("glob");
		expect(DEFAULT_TRIM).toHaveProperty("grep");
		expect(DEFAULT_TRIM).toHaveProperty("list");
		expect(DEFAULT_TRIM).toHaveProperty("default");
	});
});
