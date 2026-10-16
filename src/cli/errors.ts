/**
 * A mistake in a CLI command or its arguments. Its message is shown to the operator as is.
 */
export class CliError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CliError";
    }
}
