/*
 * Deciding whether a Bash command searches this repo's files, and so must go
 * through the Vera index instead.
 *
 * ALLOWED: piped searches (`cat x | grep foo`), which read stdin rather than
 * files; targets outside the repo; anything that is not a search tool.
 *
 * BLOCKED: the search tools below, however they are reached — directly, behind
 * git's global options, through `xargs`, or from `find -exec`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitSubcommandOf, parseCommands, stripPrefixes } from "./bash-command.mjs";

const libDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(libDir, "..", "..", "..");
const home = process.env.HOME || process.env.USERPROFILE || "";

/**
 * The tools that search file contents. `ag`, `ack` and `ugrep` are here because
 * a policy that names only grep and ripgrep is a policy anyone can step around
 * by installing something else.
 */
const SEARCH_TOOLS = new Set([
	"grep",
	"egrep",
	"fgrep",
	"rg",
	"ripgrep",
	"ag",
	"ack",
	"ack-grep",
	"ugrep",
]);

/** find's options that run another command against what it found. */
const FIND_EXEC_OPTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * Whether an argument path resolves to a location inside the repo tree.
 *
 * @param {string} argument - The path as written on the command line.
 * @returns {boolean} True when it lands inside the repo.
 */
function isInsideRepo(argument) {
	let expanded = argument;
	if (expanded === "~") {
		expanded = home;
	} else if (expanded.startsWith("~/")) {
		expanded = path.join(home, expanded.slice(2));
	}
	const absolute = path.resolve(repoRoot, expanded);
	const relative = path.relative(repoRoot, absolute);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The paths a command names, taking the first non-flag argument to be the
 * pattern rather than a path.
 *
 * @param {string[]} args - The command's arguments, tool word removed.
 * @returns {string[]} The paths named after the pattern.
 */
function pathsAfterPattern(args) {
	return args.filter((token) => !token.startsWith("-") || token === "-").slice(1);
}

/**
 * Whether a search tool's arguments point into the repo.
 *
 * @param {object} invocation - The invocation to judge.
 * @param {string} invocation.tool - The search tool's name.
 * @param {string[]} invocation.args - Its arguments.
 * @returns {boolean} True when the search reaches repo files.
 */
function searchTargetsRepo({ tool, args }) {
	const paths = pathsAfterPattern(args);
	const insidePaths = paths.filter((candidate) => isInsideRepo(candidate));
	const outsidePaths = paths.filter((candidate) => !isInsideRepo(candidate));
	if (insidePaths.length > 0) return true;
	// With no path at all, ripgrep and the silver searcher walk the working
	// directory; the grep family needs -r to do the same.
	if (paths.length === 0) {
		if (
			tool === "rg" ||
			tool === "ripgrep" ||
			tool === "ag" ||
			tool === "ack" ||
			tool === "ugrep"
		) {
			return true;
		}
		return args.some((flag) => /^-[A-Za-z]*[rR]/.test(flag) || flag === "--recursive");
	}
	return outsidePaths.length === 0;
}

/**
 * Whether a `find` invocation execs a search tool against the repo.
 *
 * @param {string[]} words - find's words, prefixes already stripped.
 * @returns {boolean} True when it does.
 */
function findExecsRepoSearch(words) {
	const execIndex = words.findIndex((word) => FIND_EXEC_OPTIONS.has(word));
	if (execIndex === -1) return false;
	if (!SEARCH_TOOLS.has(words[execIndex + 1])) return false;
	// Everything between `find` and its first option is a starting point.
	const startingPoints = words.slice(1, execIndex).filter((word) => !word.startsWith("-"));
	if (startingPoints.length === 0) return true;
	return startingPoints.some((candidate) => isInsideRepo(candidate));
}

/**
 * Whether one simple command searches the repo.
 *
 * @param {{ words: string[], pipedIn: boolean }} command - The command to judge.
 * @returns {boolean} True when it must be blocked.
 */
function shouldBlockSimpleCommand(command) {
	const { words, viaXargs } = stripPrefixes(command.words);
	if (!words.length) return false;

	if (words[0] === "git") {
		// git grep always searches the repository's tracked files, whatever
		// global options were written before the subcommand.
		return gitSubcommandOf(words) === "grep";
	}
	if (words[0] === "find") return findExecsRepoSearch(words);
	if (!SEARCH_TOOLS.has(words[0])) return false;
	// Reading a pipe is not a file search — unless xargs is what fed it, since
	// xargs passes file names as arguments rather than content on stdin.
	if (command.pipedIn && !viaXargs) return false;
	// Reached through xargs, the paths come from the pipe and are assumed to be
	// the repo's: erring toward blocking is this hook's stated policy.
	if (viaXargs) return true;
	return searchTargetsRepo({ tool: words[0], args: words.slice(1) });
}

/**
 * Whether a Bash command string searches this repo's files.
 *
 * @param {string} command - The raw command string.
 * @returns {boolean} True when it must be blocked.
 */
export function shouldBlockCommand(command) {
	return parseCommands(command).some((simple) => shouldBlockSimpleCommand(simple));
}

/**
 * The explanation shown when a search is blocked.
 *
 * @returns {string} The message, ready for stderr.
 */
export function blockMessage() {
	return [
		"BLOCKED: searching files inside this repo with grep/rg/git grep bypasses the Vera index.",
		"",
		"Use Vera instead:",
		'  - vera search "describe behaviour"   → semantic/conceptual queries',
		'  - vera grep "exact pattern"          → regex, exact strings, imports, TODOs',
		"",
		"Piped searches (`... | grep`) and targets OUTSIDE the repo are allowed.",
		"For a genuine in-repo case Vera cannot cover (e.g. a non-indexed file type),",
		"write '.claude/tool-override' with a one-line reason before the command.",
	].join("\n");
}
