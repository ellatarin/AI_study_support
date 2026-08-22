import { pathToFileURL } from "node:url";

/**
 * Whether a module is the file node was asked to run, rather than one something
 * else imported — so a script can expose its functions to a test suite without
 * doing its work on import.
 *
 * @param {string} moduleUrl - The module's own `import.meta.url`.
 * @returns {boolean} True when this module is the process entry point.
 */
export function isEntryPoint(moduleUrl) {
	if (process.argv[1] === undefined) return false;
	return moduleUrl === pathToFileURL(process.argv[1]).href;
}
