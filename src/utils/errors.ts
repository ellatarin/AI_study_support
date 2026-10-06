/**
 * The base class of the named errors. A subclass has an empty body. Its `name`
 * is the name of the subclass, which `new.target` gives (technical-design.md §8,
 * "Typed Errors").
 */
export abstract class NamedError extends Error {
	/**
	 * @param message - The description of the fault, for a person to read.
	 */
	public constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

/**
 * Gives the message of a caught value. Any value can be thrown, so a caught
 * value is `unknown` (technical-design.md §8, "Typed Errors").
 *
 * @param error - The caught value, of unknown type.
 * @returns The error's message, or the value stringified when it is not an `Error`.
 * @example
 * catch (error: unknown) {
 *   throw new AudioExtractionError(`Extraction failed: ${errorMessage(error)}`);
 * }
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
