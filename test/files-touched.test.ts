import { describe, it, expect } from "vitest";
import { FilesTouchedTracker } from "../src/files-touched.ts";

describe("FilesTouchedTracker", () => {
	it("starts empty", () => {
		const tracker = new FilesTouchedTracker();
		expect(tracker.size).toBe(0);
		expect(tracker.renderManifest()).toBe("");
	});

	// ---------------------------------------------------------------------------
	// record()
	// ---------------------------------------------------------------------------

	describe("record()", () => {
		it("records a single operation", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src/index.ts", "R");
			expect(tracker.size).toBe(1);
		});

		it("deduplicates same path", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src/index.ts", "R");
			tracker.record("src/index.ts", "E");
			expect(tracker.size).toBe(1);
		});

		it("tracks multiple operations on the same file", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src/app.ts", "R");
			tracker.record("src/app.ts", "W");
			tracker.record("src/app.ts", "E");
			const manifest = tracker.renderManifest();
			expect(manifest).toContain("`R`");
			expect(manifest).toContain("`W`");
			expect(manifest).toContain("`E`");
		});

		it("normalizes ./ prefix", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("./src/index.ts", "R");
			tracker.record("src/index.ts", "E");
			expect(tracker.size).toBe(1);
		});

		it("normalizes double slashes", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src//index.ts", "R");
			tracker.record("src/index.ts", "W");
			expect(tracker.size).toBe(1);
		});

		it("ignores empty paths", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("", "R");
			tracker.record("./", "R");
			expect(tracker.size).toBe(0);
		});

		it("handles multiple different files", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src/a.ts", "R");
			tracker.record("src/b.ts", "W");
			tracker.record("src/c.ts", "E");
			expect(tracker.size).toBe(3);
		});
	});

	// ---------------------------------------------------------------------------
	// processToolCall()
	// ---------------------------------------------------------------------------

	describe("processToolCall()", () => {
		it("tracks read tool calls", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("read", { filePath: "src/main.ts" });
			expect(tracker.renderManifest()).toContain("`R`");
			expect(tracker.renderManifest()).toContain("src/main.ts");
		});

		it("tracks file_read tool calls", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("file_read", { path: "src/other.ts" });
			expect(tracker.renderManifest()).toContain("src/other.ts");
		});

		it("tracks write tool calls", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("write", { filePath: "src/new.ts" });
			expect(tracker.renderManifest()).toContain("`W`");
		});

		it("tracks edit tool calls", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("edit", { filePath: "src/existing.ts" });
			expect(tracker.renderManifest()).toContain("`E`");
		});

		it("tracks delete tool calls", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("delete", { filePath: "src/old.ts" });
			expect(tracker.renderManifest()).toContain("`D`");
		});

		it("extracts paths from bash commands", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("bash", { command: "cat src/config.json" });
			expect(tracker.renderManifest()).toContain("src/config.json");
		});

		it("extracts paths from git commands via bash", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("bash", { command: "git add src/staged.ts" });
			expect(tracker.renderManifest()).toContain("src/staged.ts");
		});

		it("ignores unknown tools", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("unknown_tool", { path: "src/a.ts" });
			expect(tracker.size).toBe(0);
		});

		it("handles missing args gracefully", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("read", {} as Record<string, unknown>);
			expect(tracker.size).toBe(0);
		});

		it("handles non-string filePath gracefully", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("read", { filePath: 123 });
			expect(tracker.size).toBe(0);
		});

		it("accumulates operations across multiple tool calls", () => {
			const tracker = new FilesTouchedTracker();
			tracker.processToolCall("read", { filePath: "src/app.ts" });
			tracker.processToolCall("edit", { filePath: "src/app.ts" });
			const manifest = tracker.renderManifest();
			expect(manifest).toContain("`R`");
			expect(manifest).toContain("`E`");
		});
	});

	// ---------------------------------------------------------------------------
	// renderManifest()
	// ---------------------------------------------------------------------------

	describe("renderManifest()", () => {
		it("returns empty string when no files tracked", () => {
			const tracker = new FilesTouchedTracker();
			expect(tracker.renderManifest()).toBe("");
		});

		it("includes header with operation legend", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src/a.ts", "R");
			const manifest = tracker.renderManifest();
			expect(manifest).toContain("## Files Touched Manifest");
			expect(manifest).toContain("`R`=read");
		});

		it("sorts files alphabetically", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src/z.ts", "R");
			tracker.record("src/a.ts", "R");
			tracker.record("src/m.ts", "R");
			const manifest = tracker.renderManifest();
			const aPos = manifest.indexOf("src/a.ts");
			const mPos = manifest.indexOf("src/m.ts");
			const zPos = manifest.indexOf("src/z.ts");
			expect(aPos).toBeLessThan(mPos);
			expect(mPos).toBeLessThan(zPos);
		});

		it("formats each file with backticked badges", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src/app.ts", "R");
			tracker.record("src/app.ts", "W");
			const manifest = tracker.renderManifest();
			expect(manifest).toContain("- `src/app.ts` `R` `W`");
		});
	});

	// ---------------------------------------------------------------------------
	// clear()
	// ---------------------------------------------------------------------------

	describe("clear()", () => {
		it("resets the tracker", () => {
			const tracker = new FilesTouchedTracker();
			tracker.record("src/a.ts", "R");
			tracker.record("src/b.ts", "W");
			expect(tracker.size).toBe(2);
			tracker.clear();
			expect(tracker.size).toBe(0);
			expect(tracker.renderManifest()).toBe("");
		});
	});
});
