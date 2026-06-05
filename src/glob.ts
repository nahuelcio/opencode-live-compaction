// Lightweight glob matcher for protected file patterns.
// Supports: *, **, double-star-slash (zero or more dirs), ? (single char).
// No external dependencies.

function normalizePath(input: string): string {
	return input.replaceAll("\\", "/");
}

function escapeRegExpChar(ch: string): string {
	return /[\\.^$+{}()|[\]]/.test(ch) ? `\\${ch}` : ch;
}

// Test if inputPath matches a glob pattern.
// Examples:
//   matchesGlob("src/config.ts", "*.config.ts") => false
//   matchesGlob("src/app.config.ts", "**/*.config.ts") => true
//   matchesGlob("CLAUDE.md", "CLAUDE.md") => true (exact)
//   matchesGlob("src/a.ts", "src/*.ts") => true
export function matchesGlob(inputPath: string, pattern: string): boolean {
	if (!pattern) return false;

	const input = normalizePath(inputPath);
	const pat = normalizePath(pattern);

	// Exact match shortcut
	if (!pat.includes("*") && !pat.includes("?")) {
		return input === pat;
	}

	let regex = "^";

	for (let i = 0; i < pat.length; i++) {
		const ch = pat[i];

		if (ch === "*") {
			const next = pat[i + 1];
			if (next === "*") {
				const after = pat[i + 2];
				if (after === "/") {
					// **/ (zero or more directories)
					regex += "(?:.*/)?";
					i += 2;
					continue;
				}
				// ** (match everything)
				regex += ".*";
				i++;
				continue;
			}
			// * (match anything except /)
			regex += "[^/]*";
			continue;
		}

		if (ch === "?") {
			regex += "[^/]";
			continue;
		}

		if (ch === "/") {
			regex += "/";
			continue;
		}

		regex += escapeRegExpChar(ch);
	}

	regex += "$";

	return new RegExp(regex).test(input);
}

/**
 * Extract file paths from tool arguments.
 * Checks common parameter names: filePath, path, file.
 */
export function extractFilePaths(
	_tool: string,
	args: Record<string, unknown>,
): string[] {
	const paths: string[] = [];

	// Standard file path parameters
	for (const key of ["filePath", "path", "file"]) {
		const val = args[key];
		if (typeof val === "string" && val.trim()) {
			paths.push(val.trim());
		}
	}

	// Multi-edit: edits array with nested filePath
	if (Array.isArray(args.edits)) {
		for (const edit of args.edits) {
			if (
				edit &&
				typeof edit === "object" &&
				typeof (edit as Record<string, unknown>).filePath === "string"
			) {
				paths.push((edit as Record<string, string>).filePath);
			}
		}
	}

	return [...new Set(paths)];
}

/**
 * Check if any of the given file paths match any of the protected patterns.
 */
export function isFileProtected(paths: string[], patterns: string[]): boolean {
	if (paths.length === 0 || patterns.length === 0) return false;
	return paths.some((path) =>
		patterns.some((pattern) => matchesGlob(path, pattern)),
	);
}
