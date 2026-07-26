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
