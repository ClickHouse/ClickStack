import mongoose from 'mongoose';
import { z } from 'zod';

/**
 * Error category for MCP tool failures.
 *
 * - `user`   — the agent/user caused the error (bad input, not-found,
 *              bad query syntax, wrong source kind, etc.). Not alertable.
 * - `server` — unexpected system failure (uncaught exception, database
 *              outage, timeout on a system-controlled query, etc.).
 *              Alertable.
 */
export type McpErrorCategory = 'user' | 'server';

export type McpErrorResult = {
  isError: true;
  content: [{ type: 'text'; text: string }];
};

/**
 * Side-channel for error categories. Using a WeakMap instead of an object
 * property ensures `_errorCategory` can never leak through the MCP SDK's
 * `z.looseObject()` passthrough serialization, even if a result bypasses
 * `withToolTracing`.
 */
const errorCategoryMap = new WeakMap<McpErrorResult, McpErrorCategory>();

/** Retrieve the error category for a result, if one was set. */
export function getErrorCategory(
  result: McpErrorResult,
): McpErrorCategory | undefined {
  return errorCategoryMap.get(result);
}

function buildMcpError(
  text: string,
  category: McpErrorCategory,
): McpErrorResult {
  const result: McpErrorResult = {
    isError: true as const,
    content: [{ type: 'text' as const, text }],
  };
  errorCategoryMap.set(result, category);
  return result;
}

/**
 * Build an MCP error response for an agent/user-caused error (bad input,
 * not-found, bad query syntax, etc.). Not alertable.
 */
export function mcpUserError(text: string): McpErrorResult {
  return buildMcpError(text, 'user');
}

/**
 * Build an MCP error response for an unexpected system failure (uncaught
 * exception, database outage, timeout on a system-controlled query, etc.).
 * Alertable.
 */
export function mcpServerError(text: string): McpErrorResult {
  return buildMcpError(text, 'server');
}

/**
 * Validate that a string is a valid MongoDB ObjectId.
 * Returns an MCP error result if invalid, or `null` if valid.
 */
export function validateObjectId(
  id: string,
  label: string,
): McpErrorResult | null {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return mcpUserError(`Invalid ${label}`);
  }
  return null;
}

/**
 * Compact an error for inclusion in a tool response: single line,
 * capped length, no stack frames.
 */
export function sanitizeFetchError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function formatZodPath(path: (string | number)[]): string {
  return path
    .map((segment, index) =>
      typeof segment === 'number'
        ? `[${segment}]`
        : index === 0
          ? segment
          : `.${segment}`,
    )
    .join('');
}

/** Render a Zod error as one `path: message` line per issue. */
export function formatZodIssues(error: z.ZodError): string {
  return error.errors
    .map(issue => {
      const path = formatZodPath(issue.path);
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('\n');
}

type UnionOptions = readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]];

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) return unwrapSchema(schema.innerType());
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault)
    return unwrapSchema(schema.removeDefault());
  return schema;
}

/** Counts the literal and enum fields, at any object depth, that `data` satisfies. */
function countMatchedDiscriminators(
  schema: z.ZodTypeAny,
  data: unknown,
): number {
  const inner = unwrapSchema(schema);
  if (inner instanceof z.ZodLiteral || inner instanceof z.ZodEnum) {
    return inner.safeParse(data).success ? 1 : 0;
  }
  if (!(inner instanceof z.ZodObject) || typeof data !== 'object' || !data) {
    return 0;
  }
  const shape: z.ZodRawShape = inner.shape;
  const values = new Map(Object.entries(data));
  return Object.entries(shape).reduce(
    (count, [key, field]) =>
      count + countMatchedDiscriminators(field, values.get(key)),
    0,
  );
}

const isDiscriminatorIssue = (
  issue: z.ZodIssue,
): issue is z.ZodIssue &
  (z.ZodInvalidLiteralIssue | z.ZodInvalidEnumValueIssue) =>
  issue.code === z.ZodIssueCode.invalid_literal ||
  issue.code === z.ZodIssueCode.invalid_enum_value;

/**
 * `z.union` for MCP tool input. MCP SDK 1.30+ prints only a failed union's
 * top-level issue, so the error reports the branch whose literal and enum
 * fields the input matched most, or every accepted value when even that branch
 * rejects one of them.
 */
export function mcpUnion<T extends UnionOptions>(options: T) {
  const errorMap: z.ZodErrorMap = (issue, ctx) => {
    if (issue.code !== z.ZodIssueCode.invalid_union) {
      return { message: ctx.defaultError };
    }
    const branches = options.map((option, index) => ({
      error: issue.unionErrors.at(index) ?? new z.ZodError([]),
      matched: countMatchedDiscriminators(option, ctx.data),
    }));
    const [closest] = branches.sort(
      (a, b) =>
        b.matched - a.matched || a.error.issues.length - b.error.issues.length,
    );
    if (!closest) return { message: ctx.defaultError };

    const mismatchedPaths = new Set(
      closest.error.issues
        .filter(isDiscriminatorIssue)
        .map(i => formatZodPath(i.path)),
    );
    if (mismatchedPaths.size === 0) {
      return { message: formatZodIssues(closest.error) };
    }
    const discriminatorIssues = issue.unionErrors
      .flatMap(e => e.issues)
      .filter(isDiscriminatorIssue);
    const lines = [...mismatchedPaths].map(path => {
      const accepted = new Set(
        discriminatorIssues
          .filter(i => formatZodPath(i.path) === path)
          .flatMap(i =>
            i.code === z.ZodIssueCode.invalid_literal
              ? [i.expected]
              : i.options,
          )
          .map(value => JSON.stringify(value)),
      );
      return `${path}: expected one of ${[...accepted].join(', ')}`;
    });
    return { message: lines.join('\n') };
  };
  return z.union(options, { errorMap });
}
