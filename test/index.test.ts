import { describe, it, expect, vi, beforeEach } from "vitest";
import { LiveCompactionPlugin } from "../src/index.ts";

// Access the internal session trackers map for testing
// We test through the public plugin interface only

describe("LiveCompactionPlugin", () => {
	const mockCtx = {
		client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
		project: { id: "test-project", name: "test" },
		directory: "/tmp/test",
		worktree: "/tmp/test",
		serverUrl: new URL("http://localhost:4096"),
	};

	async function getHooks() {
		return await LiveCompactionPlugin(mockCtx as any);
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ---------------------------------------------------------------------------
	// Plugin initialization
	// ---------------------------------------------------------------------------

	describe("initialization", () => {
		it("returns an object with expected hooks", async () => {
			const hooks = await getHooks();
			expect(hooks["tool.execute.after"]).toBeTypeOf("function");
			expect(hooks["experimental.session.compacting"]).toBeTypeOf("function");
			expect(hooks["experimental.compaction.autocontinue"]).toBeTypeOf(
				"function",
			);
			expect(hooks.event).toBeTypeOf("function");
			expect(hooks.dispose).toBeTypeOf("function");
		});
	});

	// ---------------------------------------------------------------------------
	// tool.execute.after
	// ---------------------------------------------------------------------------

	describe("tool.execute.after", () => {
		it("records read operations", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-1",
					callID: "call-1",
					args: { filePath: "src/a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// Verify by checking compaction prompt includes the file
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-1" },
				output,
			);
			expect(output.prompt).toContain("src/a.ts");
		});

		it("records write operations", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "write",
					sessionID: "sess-2",
					callID: "call-2",
					args: { filePath: "lib/b.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-2" },
				output,
			);
			expect(output.prompt).toContain("lib/b.ts");
		});

		it("records edit operations", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "edit",
					sessionID: "sess-3",
					callID: "call-3",
					args: { filePath: "cfg.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-3" },
				output,
			);
			expect(output.prompt).toContain("cfg.ts");
		});

		it("ignores calls without sessionID", async () => {
			const hooks = await getHooks();
			// Should not throw
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "",
					callID: "call-4",
					args: { filePath: "x.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);
		});

		it("ignores calls without args", async () => {
			const hooks = await getHooks();
			// Should not throw
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-5",
					callID: "call-5",
					args: null as any,
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-5" },
				output,
			);
			// No files manifest should appear
			expect(output.prompt).not.toContain("## Files Touched Manifest");
		});

		it("tracks multiple files in same session", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-multi",
					callID: "c1",
					args: { filePath: "a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);
			await hooks["tool.execute.after"]!(
				{
					tool: "write",
					sessionID: "sess-multi",
					callID: "c2",
					args: { filePath: "b.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-multi" },
				output,
			);
			expect(output.prompt).toContain("a.ts");
			expect(output.prompt).toContain("b.ts");
		});
	});

	// ---------------------------------------------------------------------------
	// experimental.session.compacting
	// ---------------------------------------------------------------------------

	describe("experimental.session.compacting", () => {
		it("replaces output.prompt with enhanced prompt", async () => {
			const hooks = await getHooks();
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-compact" },
				output,
			);
			expect(output.prompt).toBeDefined();
			expect(output.prompt).toContain("## Brief");
			expect(output.prompt).toContain("## Task Continuity");
			expect(output.prompt).toContain("## Mandatory Reading");
		});

		it("includes files manifest when files were tracked", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-files",
					callID: "c1",
					args: { filePath: "readme.md" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-files" },
				output,
			);
			expect(output.prompt).toContain("## Files Touched");
			expect(output.prompt).toContain("readme.md");
		});

		it("clears tracker after compaction", async () => {
			const hooks = await getHooks();
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-clear",
					callID: "c1",
					args: { filePath: "x.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// First compaction should include the file
			const output1 = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-clear" },
				output1,
			);
			expect(output1.prompt).toContain("x.ts");

			// Second compaction should NOT include the file (tracker was cleared)
			const output2 = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-clear" },
				output2,
			);
			expect(output2.prompt).not.toContain("x.ts");
		});

		it("works without any tracked files", async () => {
			const hooks = await getHooks();
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-empty" },
				output,
			);
			expect(output.prompt).toBeDefined();
			expect(output.prompt).not.toContain("## Files Touched Manifest");
		});
	});

	// ---------------------------------------------------------------------------
	// experimental.compaction.autocontinue
	// ---------------------------------------------------------------------------

	describe("experimental.compaction.autocontinue", () => {
		it("sets enabled to true", async () => {
			const hooks = await getHooks();
			const output = { enabled: false };
			await hooks["experimental.compaction.autocontinue"]!({} as any, output);
			expect(output.enabled).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// event handler
	// ---------------------------------------------------------------------------

	describe("event", () => {
		it("cleans up trackers on session.deleted", async () => {
			const hooks = await getHooks();

			// Track a file
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-del",
					callID: "c1",
					args: { filePath: "y.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// Delete session
			await hooks.event!({
				event: {
					id: "evt-1",
					type: "session.deleted",
					properties: { sessionID: "sess-del" },
				},
			});

			// After deletion, compaction should not have the file
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-del" },
				output,
			);
			// New tracker was created for the session (it was deleted), so no files
			expect(output.prompt).not.toContain("y.ts");
		});

		it("ignores other event types", async () => {
			const hooks = await getHooks();
			// Should not throw
			await hooks.event!({
				event: { id: "evt-2", type: "session.updated", properties: {} },
			});
		});
	});

	// ---------------------------------------------------------------------------
	// dispose
	// ---------------------------------------------------------------------------

	describe("dispose", () => {
		it("clears all session trackers", async () => {
			const hooks = await getHooks();

			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-a",
					callID: "c1",
					args: { filePath: "a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);
			await hooks["tool.execute.after"]!(
				{
					tool: "write",
					sessionID: "sess-b",
					callID: "c2",
					args: { filePath: "b.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			await hooks.dispose!();

			// Both sessions should be cleared
			const outputA = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-a" },
				outputA,
			);
			expect(outputA.prompt).not.toContain("a.ts");

			const outputB = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-b" },
				outputB,
			);
			expect(outputB.prompt).not.toContain("b.ts");
		});
	});

	// ---------------------------------------------------------------------------
	// experimental.chat.messages.transform
	// ---------------------------------------------------------------------------

	describe("experimental.chat.messages.transform", () => {
		it("trims long bash tool outputs", async () => {
			const hooks = await getHooks();
			const longOutput = "x".repeat(5000);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "bash",
							state: { output: longOutput },
						},
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].state.output.length).toBeLessThan(1000);
			expect(messages[0].parts[0].state.output).toContain("[trimmed");
		});

		it("preserves short tool outputs", async () => {
			const hooks = await getHooks();
			const shortOutput = "File edited successfully";
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "edit",
							state: { output: shortOutput },
						},
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].state.output).toBe(shortOutput);
		});

		it("trims read outputs to 300 chars", async () => {
			const hooks = await getHooks();
			const fileContent = "line\n".repeat(200); // ~1200 chars
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: fileContent } },
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].state.output.length).toBeLessThan(400);
		});

		it("handles messages without tool parts", async () => {
			const hooks = await getHooks();
			const messages = [
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "hello" }],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].text).toBe("hello");
		});

		it("handles parts without state", async () => {
			const hooks = await getHooks();
			const messages = [
				{
					info: { role: "assistant" },
					parts: [{ type: "tool", tool: "bash" }],
				},
			];
			// Should not throw
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
		});

		it("handles parts without tool name", async () => {
			const hooks = await getHooks();
			const messages = [
				{
					info: { role: "assistant" },
					parts: [{ type: "tool", state: { output: "something" } }],
				},
			];
			// Should not modify (no tool name)
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].state.output).toBe("something");
		});
	});
});
