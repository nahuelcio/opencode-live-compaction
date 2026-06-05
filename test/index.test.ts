import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveCompactionPlugin } from "../src/index.ts";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TMP_DIR = join(import.meta.dirname, "__tmp_index_test");

function setupTmp() {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
	mkdirSync(TMP_DIR, { recursive: true });
}

function cleanupTmp() {
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
}

// Access the internal session trackers map for testing
// We test through the public plugin interface only

describe("LiveCompactionPlugin", () => {
	const mockCtx = {
		client: { app: { log: vi.fn().mockResolvedValue(undefined) } },
		project: { id: "test-project", name: "test" },
		directory: TMP_DIR,
		worktree: TMP_DIR,
		serverUrl: new URL("http://localhost:4096"),
	};

	async function getHooks() {
		return await LiveCompactionPlugin(mockCtx as any);
	}

	beforeEach(() => {
		setupTmp();
		vi.clearAllMocks();
	});

	afterEach(cleanupTmp);

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
			expect(hooks["command.execute.before"]).toBeTypeOf("function");
			expect(hooks["experimental.chat.messages.transform"]).toBeTypeOf(
				"function",
			);
		});

		it("logs initialization when debug is enabled", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ debug: true }),
			);
			const logSpy = vi.fn().mockResolvedValue(undefined);
			await LiveCompactionPlugin({
				...mockCtx,
				client: { app: { log: logSpy } },
				directory: TMP_DIR,
			} as any);
			expect(logSpy).toHaveBeenCalled();
			expect(logSpy.mock.calls[0][0]).toContain("[live-compaction]");
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

		it("includes focus directive when set via /compact:focus", async () => {
			const hooks = await getHooks();

			// First, trigger a tool call to register the session
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-focus",
					callID: "c1",
					args: { filePath: "x.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			// Set focus via /compact:focus command
			const cmdOutput = { handled: false, message: undefined };
			await hooks["command.execute.before"]!(
				{ command: "compact", args: "focus Fix the auth bug" },
				cmdOutput,
			);
			expect(cmdOutput.handled).toBe(true);
			expect(cmdOutput.message).toContain("Fix the auth bug");

			// Compaction should include the focus directive
			const output = { context: [], prompt: undefined };
			await hooks["experimental.session.compacting"]!(
				{ sessionID: "sess-focus" },
				output,
			);
			expect(output.prompt).toContain("Fix the auth bug");
			expect(output.prompt).toContain("<focus-directive>");
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
	// command.execute.before (slash commands)
	// ---------------------------------------------------------------------------

	describe("command.execute.before", () => {
		it("ignores non-compact commands", async () => {
			const hooks = await getHooks();
			const output = { handled: false, message: undefined };
			await hooks["command.execute.before"]!(
				{ command: "other", args: "" },
				output,
			);
			expect(output.handled).toBe(false);
		});

		it("lets plain /compact pass through to OpenCode", async () => {
			const hooks = await getHooks();
			const output = { handled: false, message: undefined };
			await hooks["command.execute.before"]!(
				{ command: "compact", args: "" },
				output,
			);
			expect(output.handled).toBe(false);
		});

		it("handles /compact:focus and stores directive", async () => {
			const hooks = await getHooks();

			// Register a session first
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-cmd",
					callID: "c1",
					args: { filePath: "a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { handled: false, message: undefined };
			await hooks["command.execute.before"]!(
				{ command: "compact", args: "focus Fix login bug" },
				output,
			);
			expect(output.handled).toBe(true);
			expect(output.message).toContain("Fix login bug");
		});

		it("ignores /compact:focus with empty directive", async () => {
			const hooks = await getHooks();
			// Register a session first
			await hooks["tool.execute.after"]!(
				{
					tool: "read",
					sessionID: "sess-empty-focus",
					callID: "c1",
					args: { filePath: "a.ts" },
				},
				{ title: "", output: "", metadata: {} },
			);

			const output = { handled: false, message: undefined };
			await hooks["command.execute.before"]!(
				{ command: "compact", args: "focus   " },
				output,
			);
			// Empty focus after trim — treated as plain /compact
			expect(output.handled).toBe(false);
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
	// experimental.chat.messages.transform (trim + dedup + purge)
	// ---------------------------------------------------------------------------

	describe("experimental.chat.messages.transform", () => {
		it("trims long bash tool outputs", async () => {
			const hooks = await getHooks();
			const longOutput = "x".repeat(5000);
			// Build messages with the tool call outside the protected turn window (4 turns)
			// Tool at index 1, followed by 5 user turns to push it out of the window
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "bash", state: { output: longOutput } },
					],
				},
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect((messages[0].parts[0] as any).state.output.length).toBeLessThan(
				1000,
			);
			expect((messages[0].parts[0] as any).state.output).toContain("[trimmed");
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
			// Tool at index 0, followed by 5 user turns to push it out of window
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: fileContent } },
					],
				},
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect((messages[0].parts[0] as any).state.output.length).toBeLessThan(
				400,
			);
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

		it("deduplicates identical tool calls", async () => {
			const hooks = await getHooks();
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "a.ts" },
							state: { output: "old content" },
						},
					],
				},
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "a.ts" },
							state: { output: "new content" },
						},
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			// First should be deduped
			expect(messages[0].parts[0].state.output).toContain("deduped");
			// Second should be preserved
			expect(messages[1].parts[0].state.output).toBe("new content");
		});

		it("purges large inputs from errored tools", async () => {
			const hooks = await getHooks();
			const bigInput = "x".repeat(500);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "bash",
							state: {
								status: "error",
								output: "command failed",
								input: bigInput,
							},
						},
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].state.input).toContain("purged");
			expect(messages[0].parts[0].state.output).toBe("command failed");
		});
	});

	// ---------------------------------------------------------------------------
	// config (slash command registration)
	// ---------------------------------------------------------------------------

	describe("config", () => {
		it("registers /compact command when commands enabled", async () => {
			const hooks = await getHooks();
			const opencodeConfig: Record<string, unknown> = {};
			await (hooks as any).config(opencodeConfig);
			expect(opencodeConfig.command).toHaveProperty("compact");
		});
	});

	// ---------------------------------------------------------------------------
	// Protected file patterns
	// ---------------------------------------------------------------------------

	describe("protected file patterns", () => {
		it("does not trim outputs from protected files", async () => {
			// Create a config with protected patterns
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ protectedFilePatterns: ["CLAUDE.md"] }),
			);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				directory: TMP_DIR,
			} as any);

			const longContent = "x".repeat(2000);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "CLAUDE.md" },
							state: { output: longContent },
						},
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			// Should NOT be trimmed because CLAUDE.md is protected
			expect(messages[0].parts[0].state.output).toBe(longContent);
		});

		it("trims outputs from non-protected files", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ protectedFilePatterns: ["CLAUDE.md"] }),
			);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				directory: TMP_DIR,
			} as any);

			const longContent = "x".repeat(2000);
			// Tool at index 0, followed by 5 user turns to push it out of window
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "src/other.ts" },
							state: { output: longContent },
						},
					],
				},
				{ info: { role: "user" }, parts: [{ type: "text", text: "r1" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r2" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r3" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r4" }] },
				{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
				{ info: { role: "user" }, parts: [{ type: "text", text: "r5" }] },
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			// SHOULD be trimmed (not in protected patterns + outside turn window)
			expect((messages[0].parts[0] as any).state.output.length).toBeLessThan(
				500,
			);
		});

		it("supports glob patterns for protected files", async () => {
			const dotDir = join(TMP_DIR, ".opencode");
			if (!existsSync(dotDir)) mkdirSync(dotDir, { recursive: true });
			writeFileSync(
				join(dotDir, "live-compaction.json"),
				JSON.stringify({ protectedFilePatterns: ["**/*.config.ts"] }),
			);
			const hooks = await LiveCompactionPlugin({
				...mockCtx,
				directory: TMP_DIR,
			} as any);

			const longContent = "x".repeat(2000);
			const messages = [
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							args: { filePath: "src/vitest.config.ts" },
							state: { output: longContent },
						},
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});
			expect(messages[0].parts[0].state.output).toBe(longContent);
		});
	});

	// ---------------------------------------------------------------------------
	// Turn protection
	// ---------------------------------------------------------------------------

	describe("turn protection", () => {
		it("does not trim tool outputs in recent turns", async () => {
			const hooks = await getHooks();

			// Simulate a conversation: user -> assistant (tool) -> user -> assistant (tool)
			const longContent = "x".repeat(2000);
			const messages = [
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "read the file" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "read",
							state: { output: longContent },
						},
					],
				},
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "now edit it" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{
							type: "tool",
							tool: "edit",
							state: { output: longContent },
						},
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});

			// Both tool outputs should be protected (within last 4 turns)
			expect((messages[1].parts[0] as any).state.output).toBe(longContent);
			expect((messages[3].parts[0] as any).state.output).toBe(longContent);
		});

		it("trims tool outputs outside the protected turn window", async () => {
			const hooks = await getHooks();

			// Create a longer conversation that exceeds the turn window
			const longContent = "x".repeat(2000);
			const messages = [
				// Old turn (should be trimmed)
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "old request" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: longContent } },
					],
				},
				// Turn 2
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "request 2" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "bash", state: { output: longContent } },
					],
				},
				// Turn 3
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "request 3" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: longContent } },
					],
				},
				// Turn 4
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "request 4" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: longContent } },
					],
				},
				// Turn 5 (recent, protected)
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "request 5" }],
				},
				{
					info: { role: "assistant" },
					parts: [
						{ type: "tool", tool: "read", state: { output: longContent } },
					],
				},
			];
			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});

			// Old tool output (index 1) should be trimmed
			expect((messages[1].parts[0] as any).state.output.length).toBeLessThan(
				500,
			);
			// Recent tool outputs should be protected
			expect((messages[9].parts[0] as any).state.output).toBe(longContent);
		});
	});

	// ---------------------------------------------------------------------------
	// Compress tool integration
	// ---------------------------------------------------------------------------

	describe("compress tool", () => {
		it("exposes compress tool definition", async () => {
			const hooks = await getHooks();
			expect((hooks as any).tool).toBeDefined();
			expect((hooks as any).tool.description).toContain("Compress");
			expect((hooks as any).tool.args).toHaveProperty("topic");
			expect((hooks as any).tool.args).toHaveProperty("start");
			expect((hooks as any).tool.args).toHaveProperty("end");
			expect((hooks as any).tool.args).toHaveProperty("summary");
		});

		it("queues compression on compress tool call", async () => {
			const hooks = await getHooks();

			// Simulate a compress tool call
			await hooks["tool.execute.after"]!(
				{
					tool: "compress",
					sessionID: "sess-compress",
					callID: "c-comp",
					args: {
						topic: "Auth Bug Fix",
						start: 0,
						end: 3,
						summary: "Fixed the auth bug by updating login.ts",
					},
				},
				{ title: "", output: "", metadata: {} },
			);

			// Verify by checking that messages transform applies the compression
			const messages = [
				{ info: { role: "user" }, parts: [{ type: "text", text: "fix auth" }] },
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "investigating" }],
				},
				{ info: { role: "user" }, parts: [{ type: "text", text: "try this" }] },
				{
					info: { role: "assistant" },
					parts: [{ type: "text", text: "done" }],
				},
				{
					info: { role: "user" },
					parts: [{ type: "text", text: "next task" }],
				},
			];

			await hooks["experimental.chat.messages.transform"]!({} as any, {
				messages,
			});

			// Messages 0-3 should have been compressed into one
			expect(messages).toHaveLength(2); // 5 - 4 + 1 = 2
			expect(messages[0].parts[0].text).toContain("Auth Bug Fix");
			expect(messages[0].parts[0].text).toContain("compressed-block");
			expect(messages[1].parts[0].text).toBe("next task");
		});
	});
});
