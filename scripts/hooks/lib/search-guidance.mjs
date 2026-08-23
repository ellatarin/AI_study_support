/*
 * The words a blocked tool call is answered with.
 *
 * Three hooks refuse a tool and then have to say the same two things: where to
 * search instead, and how to get through anyway. Each keeps the sentence saying
 * what it refused and why — that part genuinely differs — and takes the rest
 * from here.
 *
 * Written out at each hook, the guidance had already drifted into two wordings
 * of the same three lines, which is how an instruction stops reading as one
 * instruction.
 */

/** Where to search this codebase, for the hooks that refuse a raw search. */
export const VERA_ALTERNATIVES = [
	"Use Vera instead:",
	'  - vera search "describe behaviour"   → semantic/conceptual queries',
	'  - vera grep "exact pattern"          → regex, exact strings, imports, TODOs',
];

/** How to waive a block, once. Implemented by lib/tool-override.mjs. */
export const OVERRIDE_HINT =
	"To override: write '.claude/tool-override' with a one-line reason before this tool call.";
