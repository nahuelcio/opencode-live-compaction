import { describe, it, expect } from "vitest";
import { matchesGlob, extractFilePaths, isFileProtected } from "../src/glob.ts";

// ---------------------------------------------------------------------------
// matchesGlob
// ---------------------------------------------------------------------------

describe("matchesGlob()", () => {
	it("returns false for empty pattern", () => {
		expect(matchesGlob("src/a.ts", "")).toBe(false);
	});

	// Exact match
	it("matches exact file name", () => {
		expect(matchesGlob("AGENTS.md", "AGENTS.md")).toBe(true);
	});

	it("rejects non-matching exact name", () => {
		expect(matchesGlob("README.md", "AGENTS.md")).toBe(false);
	});

	// Single wildcard *
	it("matches single wildcard", () => {
		expect(matchesGlob("src/app.ts", "src/*.ts")).toBe(true);
	});

	it("single wildcard does not cross directories", () => {
		expect(matchesGlob("src/nested/app.ts", "src/*.ts")).toBe(false);
	});

	// Double wildcard **
	it("matches double wildcard across directories", () => {
		expect(matchesGlob("src/nested/app.ts", "src/**/*.ts")).toBe(true);
	});

	it("matches double wildcard prefix", () => {
		expect(matchesGlob("deep/nested/dir/app.ts", "**/*.ts")).toBe(true);
	});

	// ? wildcard
	it("matches single char wildcard", () => {
		expect(matchesGlob("src/a.ts", "src/?.ts")).toBe(true);
	});

	it("question mark does not match multiple chars", () => {
		expect(matchesGlob("src/ab.ts", "src/?.ts")).toBe(false);
	});

	// Config patterns
	it("matches config file pattern", () => {
		expect(matchesGlob("src/app.config.ts", "**/*.config.ts")).toBe(true);
	});

	it("matches specific config file", () => {
		expect(
			matchesGlob(
				".opencode/live-compaction.json",
				".opencode/live-compaction.json",
			),
		).toBe(true);
	});

	// Backslash normalization
	it("normalizes backslashes", () => {
		expect(matchesGlob("src\\app.ts", "src/*.ts")).toBe(true);
	});

	// Special regex chars
	it("handles dots in patterns", () => {
		expect(matchesGlob("file.ts", "file.ts")).toBe(true);
		expect(matchesGlob("file_ts", "file.ts")).toBe(false);
	});

	it("handles parentheses in paths", () => {
		expect(matchesGlob("src/(app)/file.ts", "src/(app)/*.ts")).toBe(true);
	});

	it("matches bare double wildcard", () => {
		expect(matchesGlob("anything/at/all.ts", "**.ts")).toBe(true);
	});

	it("matches double wildcard without slash", () => {
		expect(matchesGlob("foobarbaz", "**bar**")).toBe(true);
	});

	it("handles multiple wildcards in pattern", () => {
		expect(matchesGlob("src/app.test.ts", "**/*.test.*")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// extractFilePaths
// ---------------------------------------------------------------------------

describe("extractFilePaths()", () => {
	it("extracts filePath parameter", () => {
		const paths = extractFilePaths("read", { filePath: "src/a.ts" });
		expect(paths).toEqual(["src/a.ts"]);
	});

	it("extracts path parameter", () => {
		const paths = extractFilePaths("read", { path: "src/b.ts" });
		expect(paths).toEqual(["src/b.ts"]);
	});

	it("extracts file parameter", () => {
		const paths = extractFilePaths("read", { file: "src/c.ts" });
		expect(paths).toEqual(["src/c.ts"]);
	});

	it("deduplicates paths", () => {
		const paths = extractFilePaths("read", {
			filePath: "src/a.ts",
			path: "src/a.ts",
		});
		expect(paths).toEqual(["src/a.ts"]);
	});

	it("returns empty for no paths", () => {
		const paths = extractFilePaths("bash", { command: "ls" });
		expect(paths).toEqual([]);
	});

	it("ignores empty strings", () => {
		const paths = extractFilePaths("read", { filePath: "" });
		expect(paths).toEqual([]);
	});

	it("extracts from multi-edit edits array", () => {
		const paths = extractFilePaths("multiedit", {
			filePath: "main.ts",
			edits: [{ filePath: "a.ts" }, { filePath: "b.ts" }],
		});
		expect(paths).toContain("main.ts");
		expect(paths).toContain("a.ts");
		expect(paths).toContain("b.ts");
	});
});

// ---------------------------------------------------------------------------
// isFileProtected
// ---------------------------------------------------------------------------

describe("isFileProtected()", () => {
	it("returns false for empty patterns", () => {
		expect(isFileProtected(["src/a.ts"], [])).toBe(false);
	});

	it("returns false for empty paths", () => {
		expect(isFileProtected([], ["*.ts"])).toBe(false);
	});

	it("returns true for matching pattern", () => {
		expect(isFileProtected(["AGENTS.md"], ["AGENTS.md"])).toBe(true);
	});

	it("returns true for glob match", () => {
		expect(isFileProtected(["src/app.config.ts"], ["**/*.config.ts"])).toBe(
			true,
		);
	});

	it("returns false for no match", () => {
		expect(isFileProtected(["src/app.ts"], ["*.config.ts"])).toBe(false);
	});

	it("checks multiple paths", () => {
		expect(isFileProtected(["src/a.ts", "AGENTS.md"], ["AGENTS.md"])).toBe(
			true,
		);
	});

	it("checks multiple patterns", () => {
		expect(isFileProtected(["src/app.ts"], ["AGENTS.md", "**/*.ts"])).toBe(
			true,
		);
	});
});
