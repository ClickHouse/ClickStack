import { serializeError } from 'serialize-error';

export enum StatusCode {
  BAD_REQUEST = 400,
  CONFLICT = 409,
  CONTENT_TOO_LARGE = 413,
  FORBIDDEN = 403,
  INTERNAL_SERVER = 500,
  NOT_FOUND = 404,
  OK = 200,
  UNAUTHORIZED = 401,
}

export class BaseError extends Error {
  name: string;

  statusCode: StatusCode;

  isOperational: boolean;

  constructor(
    name: string,
    statusCode: StatusCode,
    isOperational: boolean,
    description: string,
  ) {
    super(description);

    Object.setPrototypeOf(this, BaseError.prototype);

    this.name = name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

export class Api500Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.INTERNAL_SERVER, true, 'Internal Server Error');
  }
}

export class Api400Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.BAD_REQUEST, true, 'Bad Request');
  }
}

export class Api404Error extends BaseError {
  constructor(name: string) {
    super(name, StatusCode.NOT_FOUND, true, 'Not Found');
  }
}

export const isOperationalError = (error: Error) => {
  if (error instanceof BaseError) {
    return error.isOperational;
  }
  return false;
};

// MongoDB duplicate-key error (unique-index violation). Used to translate a
// racing or colliding write into a 400 instead of a generic 500.
export const isDuplicateKeyError = (e: unknown): boolean =>
  e != null &&
  typeof e === 'object' &&
  (e as { code?: unknown }).code === 11000;

// Guards against self-referential cause chains.
const MAX_CAUSE_DEPTH = 5;

/**
 * serializeError, keeping `cause` and AggregateError's `errors`, which it
 * drops. undici's fetch rejects with a bare "fetch failed" and puts the
 * reason (DNS, connect, TLS) only on `cause`.
 */
export const serializeErrorWithCause = (error: unknown, depth = 0): unknown => {
  if (!(error instanceof Error)) {
    return serializeError(error);
  }
  const serialized: Record<string, unknown> = { ...serializeError(error) };
  if (depth >= MAX_CAUSE_DEPTH) {
    return serialized;
  }
  if (error.cause != null) {
    serialized.cause = serializeErrorWithCause(error.cause, depth + 1);
  }
  if (error instanceof AggregateError) {
    serialized.errors = error.errors.map(e =>
      serializeErrorWithCause(e, depth + 1),
    );
  }
  return serialized;
};
