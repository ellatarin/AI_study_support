/**
 * Base class for the pipeline's typed error classes. Subclasses extend it with an
 * empty body; the concrete subclass name is captured as `name` automatically via
 * `new.target`, so each error stays a distinct `instanceof` type without
 * repeating constructor boilerplate.
 */
export abstract class NamedError extends Error {
	/**
	 * @param message - Human-readable description of the fault.
	 */
	public constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

/**
 * Renders a caught value as a message string. A `catch` binding is typed
 * `unknown` because any value can be thrown, so every caller that wants to
 * report what went wrong needs this same narrowing — it lives here once rather
 * than at each catch site.
 *
 * @param error - The caught value, of unknown type.
 * @returns The error's message, or the value stringified when it is not an `Error`.
 * @example
 * catch (error: unknown) {
 *   throw new StageError(`Extraction failed: ${errorMessage(error)}`);
 * }
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
