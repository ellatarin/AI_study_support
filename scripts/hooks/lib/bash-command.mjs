/*
 * Parsing for the command string a Bash tool call carries.
 *
 * Two hooks need to know what a command actually does rather than what it
 * contains as text: pre-commit-check must recognise a commit, and
 * block-bash-grep must recognise a codebase search. Substring matching is what
 * they used to do, and it is how `git -C . commit` slipped past the entire
 * commit gate.
 *
 * Detection is heuristic and deliberately errs toward acting. Known gaps:
 * command substitution `$(…)` and backticks are treated as fresh command
 * contexts, and a substitution inside double quotes is not split out at all.
 */

/** Command prefixes that wrap another command rather than being one. */
const COMMAND_PREFIXES = new Set(["sudo", "command", "time", "nice", "env"]);

/**
 * Git's global options, which sit between `git` and its subcommand. These take
 * a separate following value unless written with `=`; every other global option
 * stands alone.
 */
const GIT_OPTIONS_TAKING_A_VALUE = new Set([
	"-C",
	"-c",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--exec-path",
	"--config-env",
]);

/** xargs options that take a separate following value. */
const XARGS_OPTIONS_TAKING_A_VALUE = new Set([
	"-n",
	"-P",
	"-I",
	"-i",
	"-d",
	"-s",
	"-L",
	"-a",
	"-E",
]);

/**
 * Splits a command string into words and shell operators, respecting quotes.
 *
 * @param {string} command - The raw command string.
 * @returns {{ kind: string, value?: string }[]} The tokens found.
 */
function lex(command) {
	const tokens = [];
	let current = "";
	let quote = null;
	const flush = () => {
		if (current !== "") {
			tokens.push({ kind: "word", value: current });
			current = "";
		}
	};
	for (let index = 0; index < command.length; index += 1) {
		const char = command[index];
		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === "\\") {
			current += command[index + 1] || "";
			index += 1;
			continue;
		}
		const pair = command.slice(index, index + 2);
		if (pair === "&&" || pair === "||" || pair === "$(") {
			flush();
			tokens.push({ kind: "sep" });
			index += 1;
			continue;
		}
		if (char === "|") {
			flush();
			tokens.push({ kind: "pipe" });
			continue;
		}
		if (
			char === ";" ||
			char === "\n" ||
			char === "&" ||
			char === "`" ||
			char === "(" ||
			char === ")"
		) {
			flush();
			tokens.push({ kind: "sep" });
			continue;
		}
		if (char === " " || char === "\t" || char === "\r") {
			flush();
			continue;
		}
		current += char;
	}
	flush();
	return tokens;
}

/**
 * Groups lexed tokens into simple commands, tracking whether each reads a pipe.
 *
 * @param {{ kind: string, value?: string }[]} tokens - The tokens to group.
 * @returns {{ words: string[], pipedIn: boolean }[]} The simple commands found.
 */
function toCommands(tokens) {
	const commands = [];
	let words = [];
	let pipedIn = false;
	const flush = () => {
		if (words.length) {
			commands.push({ words, pipedIn });
		}
		words = [];
	};
	for (const token of tokens) {
		if (token.kind === "word") {
			words.push(token.value);
			continue;
		}
		flush();
		pipedIn = token.kind === "pipe";
	}
	flush();
	return commands;
}

/**
 * Every simple command in a command string.
 *
 * @param {string} command - The raw command string.
 * @returns {{ words: string[], pipedIn: boolean }[]} The simple commands found.
 */
export function parseCommands(command) {
	return toCommands(lex(command));
}

/**
 * Strips leading `VAR=value` assignments and wrapping prefixes such as `sudo`,
 * reporting separately whether the command was reached through `xargs` — which
 * matters because xargs turns its stdin into arguments, so the command it
 * invokes is reading files rather than a pipe.
 *
 * @param {string[]} words - One simple command's words.
 * @returns {{ words: string[], viaXargs: boolean }} The command proper, and how it was reached.
 */
export function stripPrefixes(words) {
	const rest = [...words];
	let viaXargs = false;
	while (rest.length) {
		const head = rest[0];
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head) || COMMAND_PREFIXES.has(head)) {
			rest.shift();
			continue;
		}
		if (head === "xargs") {
			rest.shift();
			viaXargs = true;
			while (rest.length && rest[0].startsWith("-")) {
				const option = rest.shift();
				if (XARGS_OPTIONS_TAKING_A_VALUE.has(option) && rest.length) rest.shift();
			}
			continue;
		}
		break;
	}
	return { words: rest, viaXargs };
}

/**
 * The subcommand a git invocation runs, skipping the global options that may
 * sit between `git` and it.
 *
 * @param {string[]} words - One simple command's words, prefixes already stripped.
 * @returns {string | null} The subcommand, or `null` when this is not a git command.
 */
export function gitSubcommandOf(words) {
	if (words[0] !== "git") return null;
	let index = 1;
	while (index < words.length && words[index].startsWith("-")) {
		const option = words[index];
		index += 1;
		if (!option.includes("=") && GIT_OPTIONS_TAKING_A_VALUE.has(option)) index += 1;
	}
	return words[index] ?? null;
}

/**
 * Whether a command string runs `git commit`.
 *
 * The structured scan catches the forms substring matching missed — `git -C .
 * commit`, `git -c user.name=x commit`. The substring check is kept alongside
 * it so this can only ever fire more often than the old test did, never less:
 * a commit hidden inside quotes or a heredoc still trips it, and the cost of a
 * false positive is only that the checks run when they need not have.
 *
 * @param {string} command - The raw command string.
 * @returns {boolean} True when the command appears to commit.
 */
export function isGitCommit(command) {
	if (command.includes("git commit")) return true;
	return parseCommands(command).some((simple) => {
		const { words } = stripPrefixes(simple.words);
		return gitSubcommandOf(words) === "commit";
	});
}
