/**
 * The body of every error response.
 */
export interface ErrorResponse {
    readonly error: string;
}

/**
 * An error that maps to an HTTP response with the body `{ error: message }`.
 */
export class APIError extends Error {
    constructor(
        readonly statusCode: number,
        message: string,
        readonly headers: Readonly<Record<string, string>> = {},
    ) {
        super(message);
        this.name = new.target.name;
    }

    /**
     * Builds the response body for this error.
     */
    toResponse(): ErrorResponse {
        return { error: this.message };
    }
}

export class BadRequestError extends APIError {
    constructor(message: string) {
        super(400, message);
    }
}

export class UnauthorizedError extends APIError {
    constructor(message = "Unauthorized") {
        super(401, message);
    }
}

export class ServiceUnavailableError extends APIError {
    constructor(message: string, retryAfterSeconds: number) {
        super(503, message, { "Retry-After": retryAfterSeconds.toString() });
    }
}
