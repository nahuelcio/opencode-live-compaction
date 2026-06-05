import { describe, it, expect } from "vitest";
import {
	toolCallKey,
	applyDedup,
	findErroredParts,
	applyPurgeErrors,
} from "../src/strategies.ts";
import { mergeConfig } from "../src/config.ts";

// ---------------------------------------------------------------------------
// toolCallKey
// ---------------------------------------------------------------------------

describe("toolCallKey()", () => {
	it("produces same key for identical tool+args", () => {
		const a = toolCallKey("read", { filePath: "src/a.ts" });
		const b = toolCallKey("read", { filePath: "src/a.ts" });
		expect(a).toBe(b);
	});

	it("produces different key for different tools", () => {
		const a = toolCallKey("read", { filePath: "src/a.ts" });
		const b = toolCallKey("write", { filePath: "src/a.ts" });
		expect(a).not.toBe(b);
	});

	it("produces different key for different args", () => {
		const a = toolCallKey("read", { filePath: "src/a.ts" });
		const b = toolCallKey("read", { filePath: "src/b.ts" });
		expect(a).not.toBe(b);
	});

	it("sorts object keys for determinism", () => {
		const a = toolCallKey("bash", { command: "ls", cwd: "/tmp" });
		const b = toolCallKey("bash", { cwd: "/tmp", command: "ls" });
		expect(a).toBe(b);
	});

	it("handles null/undefined args", () => {
		const a = toolCallKey("tool", null);
		const b = toolCallKey("tool", undefined);
		expect(typeof a).toBe("string");
		expect(typeof b).toBe("string");
	});

	it("handles primitive args", () => {
		const a = toolCallKey("tool", 42);
		const b = toolCallKey("tool", "hello");
		expect(a).not.toBe(b);
	});
});

// ---------------------------------------------------------------------------
// applyDedup
// ---------------------------------------------------------------------------

describe("applyDedup()", () => {
	function makeMsg(tool: string, args: unknown, output: string) {
		return {
			info: { role: "assistant" },
			parts: [
				{
					type: "tool",
					tool,
					args,
					state: { output },
				},
			],
		};
	}

	it("returns 0 when dedup is disabled", () => {
		const cfg = mergeConfig({ dedup: { enabled: false } });
		const msgs = [
			makeMsg("read", { filePath: "a.ts" }, "content1"),
			makeMsg("read", { filePath: "a.ts" }, "content2"),
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(0);
		expect(msgs[0].parts[0].state.output).toBe("content1");
	});

	it("deduplicates identical tool calls, keeping the last", () => {
		const cfg = mergeConfig({});
		const msgs = [
			makeMsg("read", { filePath: "a.ts" }, "content-v1"),
			makeMsg("read", { filePath: "a.ts" }, "content-v2"),
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(1);
		// First call should be deduped
		expect(msgs[0].parts[0].state.output).toContain("deduped");
		// Second call should be preserved
		expect(msgs[0].parts[0].state.output).not.toBe("content-v2");
		expect(msgs[1].parts[0].state.output).toBe("content-v2");
	});

	it("does not dedup different tools", () => {
		const cfg = mergeConfig({});
		const msgs = [
			makeMsg("read", { filePath: "a.ts" }, "content1"),
			makeMsg("write", { filePath: "a.ts" }, "content2"),
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(0);
	});

	it("does not dedup different args", () => {
		const cfg = mergeConfig({});
		const msgs = [
			makeMsg("read", { filePath: "a.ts" }, "content1"),
			makeMsg("read", { filePath: "b.ts" }, "content2"),
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(0);
	});

	it("handles 3+ duplicates", () => {
		const cfg = mergeConfig({});
		const msgs = [
			makeMsg("bash", { command: "ls" }, "v1"),
			makeMsg("bash", { command: "ls" }, "v2"),
			makeMsg("bash", { command: "ls" }, "v3"),
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(2); // first two deduped, last kept
		expect(msgs[0].parts[0].state.output).toContain("deduped");
		expect(msgs[1].parts[0].state.output).toContain("deduped");
		expect(msgs[2].parts[0].state.output).toBe("v3");
	});

	it("skips protected tools", () => {
		const cfg = mergeConfig({ dedup: { protectedTools: ["bash"] } });
		const msgs = [
			makeMsg("bash", { command: "ls" }, "v1"),
			makeMsg("bash", { command: "ls" }, "v2"),
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(0);
	});

	it("handles messages with non-tool parts", () => {
		const cfg = mergeConfig({});
		const msgs = [
			{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
			makeMsg("read", { filePath: "a.ts" }, "content1"),
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(0);
	});

	it("handles parts without state", () => {
		const cfg = mergeConfig({});
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [{ type: "tool", tool: "read" }],
			},
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(0);
	});

	it("handles duplicate tool calls without state gracefully", () => {
		const cfg = mergeConfig({});
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [{ type: "tool", tool: "read", args: { filePath: "a.ts" } }],
			},
			{
				info: { role: "assistant" },
				parts: [{ type: "tool", tool: "read", args: { filePath: "a.ts" } }],
			},
		];
		const count = applyDedup(msgs as any, cfg);
		// First one should be "deduped" (but no state to modify)
		expect(count).toBe(1);
	});

	it("deduplicates with nested args objects", () => {
		const cfg = mergeConfig({});
		const nestedArgs = { config: { nested: { deep: true } }, filePath: "a.ts" };
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [{ type: "tool", tool: "read", args: nestedArgs, state: { output: "v1" } }],
			},
			{
				info: { role: "assistant" },
				parts: [{ type: "tool", tool: "read", args: { ...nestedArgs }, state: { output: "v2" } }],
			},
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(1);
		expect(msgs[0].parts[0].state!.output).toContain("deduped");
	});

	it("deduplicates with swapped key order in args", () => {
		const cfg = mergeConfig({});
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [{ type: "tool", tool: "bash", args: { command: "ls", cwd: "/tmp" }, state: { output: "v1" } }],
			},
			{
				info: { role: "assistant" },
				parts: [{ type: "tool", tool: "bash", args: { cwd: "/tmp", command: "ls" }, state: { output: "v2" } }],
			},
		];
		const count = applyDedup(msgs as any, cfg);
		expect(count).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// findErroredParts
// ---------------------------------------------------------------------------

describe("findErroredParts()", () => {
	it("finds parts with error status", () => {
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { status: "error", output: "ENOENT" },
					},
				],
			},
		];
		const found = findErroredParts(msgs as any);
		expect(found).toHaveLength(1);
		expect(found[0]).toEqual({ msgIdx: 0, partIdx: 0 });
	});

	it("finds parts with failed status", () => {
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { status: "failed", output: "killed" },
					},
				],
			},
		];
		const found = findErroredParts(msgs as any);
		expect(found).toHaveLength(1);
	});

	it("ignores successful tool calls", () => {
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { status: "success", output: "ok" },
					},
				],
			},
		];
		const found = findErroredParts(msgs as any);
		expect(found).toHaveLength(0);
	});

	it("ignores non-tool parts", () => {
		const msgs = [
			{
				info: { role: "user" },
				parts: [{ type: "text", text: "hello" }],
			},
		];
		const found = findErroredParts(msgs as any);
		expect(found).toHaveLength(0);
	});

	it("ignores parts without state", () => {
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [{ type: "tool", tool: "bash" }],
			},
		];
		const found = findErroredParts(msgs as any);
		expect(found).toHaveLength(0);
	});

	it("finds multiple errored parts", () => {
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { status: "error", output: "err1" },
					},
					{
						type: "tool",
						tool: "bash",
						state: { status: "error", output: "err2" },
					},
				],
			},
		];
		const found = findErroredParts(msgs as any);
		expect(found).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// applyPurgeErrors
// ---------------------------------------------------------------------------

describe("applyPurgeErrors()", () => {
	it("returns 0 when purge is disabled", () => {
		const cfg = mergeConfig({ purgeErrors: { enabled: false } });
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { status: "error", output: "fail", input: "x".repeat(200) },
					},
				],
			},
		];
		const count = applyPurgeErrors(msgs as any, cfg);
		expect(count).toBe(0);
		expect(msgs[0].parts[0].state.input).toBe("x".repeat(200));
	});

	it("purges large inputs from errored tools", () => {
		const cfg = mergeConfig({});
		const bigInput = "x".repeat(500);
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { status: "error", output: "fail", input: bigInput },
					},
				],
			},
		];
		const count = applyPurgeErrors(msgs as any, cfg);
		expect(count).toBe(1);
		expect(msgs[0].parts[0].state.input).toContain("purged");
		expect(msgs[0].parts[0].state.input).toContain("500 chars");
	});

	it("preserves small inputs (< 100 chars)", () => {
		const cfg = mergeConfig({});
		const smallInput = "short input";
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { status: "error", output: "fail", input: smallInput },
					},
				],
			},
		];
		const count = applyPurgeErrors(msgs as any, cfg);
		expect(count).toBe(0);
		expect(msgs[0].parts[0].state.input).toBe(smallInput);
	});

	it("preserves error output (only input is purged)", () => {
		const cfg = mergeConfig({});
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: {
							status: "error",
							output: "ENOENT: no such file or directory",
							input: "x".repeat(200),
						},
					},
				],
			},
		];
		applyPurgeErrors(msgs as any, cfg);
		expect(msgs[0].parts[0].state.output).toBe(
			"ENOENT: no such file or directory",
		);
	});

	it("handles parts without input", () => {
		const cfg = mergeConfig({});
		const msgs = [
			{
				info: { role: "assistant" },
				parts: [
					{
						type: "tool",
						tool: "bash",
						state: { status: "error", output: "fail" },
					},
				],
			},
		];
		const count = applyPurgeErrors(msgs as any, cfg);
		expect(count).toBe(0);
	});
});
