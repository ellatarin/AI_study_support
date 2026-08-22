import { describe, expect, it } from "vitest";
import { shouldBlockCommand } from "./search-block.mjs";

describe("shouldBlockCommand", () => {
	it.each([
		{ command: "grep -n needle docs/x.md", why: "a path inside the repo is named" },
		{ command: "grep -r needle .", why: "a recursive search targets the working directory" },
		{ command: "rg needle", why: "ripgrep is given no path and so searches the tree" },
		{ command: "git grep needle", why: "git grep always searches tracked files" },
		{ command: "git -C . grep needle", why: "a -C option precedes git grep" },
		{ command: "git --no-pager grep needle", why: "a global option precedes git grep" },
		{ command: "git -c core.pager=cat grep needle", why: "a -c option precedes git grep" },
		{
			command: "git ls-files | xargs grep needle",
			why: "xargs turns the pipe into file arguments",
		},
		{ command: "git ls-files | xargs -0 grep needle", why: "xargs carries options" },
		{ command: "find . -exec grep needle {} ;", why: "find execs a search inside the repo" },
		{
			command: "find src -execdir grep needle {} ;",
			why: "find execdirs a search inside the repo",
		},
		{ command: "ag needle", why: "the silver searcher is a search tool too" },
		{ command: "ack needle", why: "ack is a search tool too" },
		{ command: "ugrep needle", why: "ugrep is a search tool too" },
		{ command: "ls && grep -r needle src", why: "the search follows another command" },
	])("should block when $why", ({ command }) => {
		expect(shouldBlockCommand(command)).toBe(true);
	});

	it.each([
		{ command: "cat file | grep needle", why: "the search reads a pipe rather than files" },
		{ command: "grep needle /tmp/list", why: "the path is outside the repo" },
		{ command: "rg needle ~/.claude", why: "the path is outside the repo" },
		{ command: "find /tmp -exec grep needle {} ;", why: "find targets a tree outside the repo" },
		{
			command: "find . -name '*.test.ts'",
			why: "find is listing paths rather than searching content",
		},
		{ command: "ls -la", why: "no search tool is involved" },
		{ command: "vera grep needle", why: "vera is the tool the policy asks for" },
	])("should allow when $why", ({ command }) => {
		expect(shouldBlockCommand(command)).toBe(false);
	});
});
