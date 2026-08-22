import { describe, expect, it } from "vitest";
import { isGitCommit, parseCommands, stripPrefixes } from "./bash-command.mjs";

describe("parseCommands", () => {
	it("should return two commands when they are joined by &&", () => {
		const commands = parseCommands("git add file && git commit -m message");

		expect(commands.map((command) => command.words[1])).toEqual(["add", "commit"]);
	});

	it("should mark the second command as piped when a pipe joins them", () => {
		const [, second] = parseCommands("cat file | grep needle");

		expect(second.pipedIn).toBe(true);
	});

	it("should not mark a command as piped when nothing feeds it", () => {
		const [first] = parseCommands("cat file | grep needle");

		expect(first.pipedIn).toBe(false);
	});

	it("should keep a quoted argument as one word when it contains spaces", () => {
		const [only] = parseCommands('git commit -m "two words"');

		expect(only.words).toEqual(["git", "commit", "-m", "two words"]);
	});

	it.each([";", "\n", "&&", "||"])("should separate commands when %s divides them", (separator) => {
		const commands = parseCommands(`ls${separator}pwd`);

		expect(commands.map((command) => command.words[0])).toEqual(["ls", "pwd"]);
	});
});

describe("stripPrefixes", () => {
	it.each([
		"sudo",
		"command",
		"time",
		"nice",
		"env",
	])("should drop %s when it wraps the real command", (prefix) => {
		const { words } = stripPrefixes([prefix, "grep", "needle"]);

		expect(words).toEqual(["grep", "needle"]);
	});

	it("should drop a leading assignment when the command is prefixed by one", () => {
		const { words } = stripPrefixes(["LC_ALL=C", "grep", "needle"]);

		expect(words).toEqual(["grep", "needle"]);
	});

	it("should report the command as reached through xargs when xargs invokes it", () => {
		const { words, viaXargs } = stripPrefixes(["xargs", "grep", "needle"]);

		expect({ words, viaXargs }).toEqual({ words: ["grep", "needle"], viaXargs: true });
	});

	it("should drop xargs options when they precede the command", () => {
		const { words } = stripPrefixes(["xargs", "-0", "-n", "1", "grep", "needle"]);

		expect(words).toEqual(["grep", "needle"]);
	});
});

describe("isGitCommit", () => {
	it.each([
		{ command: "git commit -m message", why: "the plain form" },
		{ command: "git -C . commit -m message", why: "a -C path option precedes it" },
		{ command: "git -c user.name=x commit -m message", why: "a -c config option precedes it" },
		{ command: "git --no-pager -C . commit", why: "several global options precede it" },
		{ command: "git --git-dir=.git commit", why: "an option written with = precedes it" },
		{ command: "git add file && git commit -m message", why: "another command precedes it" },
		{ command: "sudo git commit", why: "a prefix wraps it" },
		{ command: 'echo "$(git commit -m x)"', why: "it is quoted inside a substitution" },
	])("should detect a commit when $why", ({ command }) => {
		expect(isGitCommit(command)).toBe(true);
	});

	it.each([
		{ command: "git status", why: "the subcommand is status" },
		{ command: "git -C . log --oneline", why: "a global option precedes a different subcommand" },
		{ command: "git push origin main", why: "the subcommand is push" },
		{ command: "echo hello", why: "git is not involved at all" },
	])("should not detect a commit when $why", ({ command }) => {
		expect(isGitCommit(command)).toBe(false);
	});
});
