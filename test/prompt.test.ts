import { describe, it, expect } from "vitest";
import {
	buildCompactionPrompt,
	COMPACTION_SYSTEM_PROMPT,
} from "../src/prompt.ts";

describe("buildCompactionPrompt()", () => {
	it("returns a non-empty string", () => {
		const prompt = buildCompactionPrompt({});
		expect(typeof prompt).toBe("string");
		expect(prompt.length).toBeGreaterThan(100);
	});

	it("contains all 11 sections in the template", () => {
		const prompt = buildCompactionPrompt({});
		const sections = [
			"## Brief",
			"## User Intent Trail",
			"## Constraints & Preferences",
			"## Errors & Dead Ends",
			"## Key Decisions",
			"## Status",
			"### Done",
			"### In Progress",
			"### Blocked",
			"## Task Continuity",
			"## Open Issues & Questions",
			"## Next Steps",
			"## Mandatory Reading",
		];
		for (const section of sections) {
			expect(prompt).toContain(section);
		}
	});

	it("includes the <template> block", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("<template>");
		expect(prompt).toContain("</template>");
	});

	it("includes rules section", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("Rules:");
		expect(prompt).toContain("(none)");
	});

	it("does NOT include files block when no filesTouched", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).not.toContain("## Files Touched");
	});

	it("includes files block when filesTouched is provided", () => {
		const prompt = buildCompactionPrompt({
			filesTouched: "- `src/app.ts` `R` `E`",
		});
		expect(prompt).toContain("## Files Touched");
		expect(prompt).toContain("- `src/app.ts` `R` `E`");
	});

	it("does NOT include focus directive when not provided", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).not.toContain("<focus-directive>");
	});

	it("includes focus directive when provided", () => {
		const prompt = buildCompactionPrompt({
			focusDirective: "Fix the auth bug in login.ts",
		});
		expect(prompt).toContain("<focus-directive>");
		expect(prompt).toContain("Fix the auth bug in login.ts");
	});

	it("includes previous-summary instructions", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("<previous-summary>");
	});

	it("mentions anchored summary behavior", () => {
		const prompt = buildCompactionPrompt({});
		expect(prompt).toContain("anchored summary");
	});

	it("combines files and focus together", () => {
		const prompt = buildCompactionPrompt({
			filesTouched: "- `config.json` `W`",
			focusDirective: "Update config for production",
		});
		expect(prompt).toContain("## Files Touched");
		expect(prompt).toContain("<focus-directive>");
		expect(prompt).toContain("Update config for production");
	});
});

describe("COMPACTION_SYSTEM_PROMPT", () => {
	it("is a non-empty string", () => {
		expect(typeof COMPACTION_SYSTEM_PROMPT).toBe("string");
		expect(COMPACTION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
	});

	it("mentions summarizer role", () => {
		expect(COMPACTION_SYSTEM_PROMPT.toLowerCase()).toContain("summariz");
	});
});
