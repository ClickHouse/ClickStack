import mongoose from 'mongoose';
import { z } from 'zod/v3';

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
type Path = (string | number)[];

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) return unwrapSchema(schema.innerType());
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault)
    return unwrapSchema(schema.removeDefault());
  return schema;
}

function objectShape(schema: z.ZodTypeAny): Map<string, z.ZodTypeAny> | null {
  const inner = unwrapSchema(schema);
  if (!(inner instanceof z.ZodObject)) return null;
  const shape: z.ZodRawShape = inner.shape;
  return new Map(Object.entries(shape));
}

/** Records every object path at which `schema` requires a literal value. */
function collectLiteralPaths(
  schema: z.ZodTypeAny,
  path: Path,
  into: Set<string>,
) {
  if (unwrapSchema(schema) instanceof z.ZodLiteral)
    into.add(formatZodPath(path));
  for (const [key, field] of objectShape(schema) ?? []) {
    collectLiteralPaths(field, [...path, key], into);
  }
}

/**
 * Scores how well `data` fits a branch on the discriminator fields: +1 for
 * each one it satisfies, -1 for each one it sets that the branch doesn't have.
 */
function scoreBranch(
  schema: z.ZodTypeAny,
  data: unknown,
  path: Path,
  discriminators: Set<string>,
): number {
  const inner = unwrapSchema(schema);
  if (inner instanceof z.ZodLiteral || inner instanceof z.ZodEnum) {
    if (!discriminators.has(formatZodPath(path))) return 0;
    return inner.safeParse(data).success ? 1 : 0;
  }
  const shape = objectShape(inner);
  if (!shape || typeof data !== 'object' || !data) return 0;
  let score = 0;
  for (const [key, value] of Object.entries(data)) {
    const field = shape.get(key);
    if (field) {
      score += scoreBranch(field, value, [...path, key], discriminators);
    } else if (
      value !== undefined &&
      discriminators.has(formatZodPath([...path, key]))
    ) {
      score -= 1;
    }
  }
  return score;
}

/**
 * `z.union` for MCP tool input. MCP SDK 1.30+ prints only a failed union's
 * top-level issue, so the error reports the branch that best fits the input's
 * discriminators (fields some branch pins to a literal). When that branch
 * rejects a discriminator, it lists the values the best-fitting branches
 * accept.
 */
export function mcpUnion<T extends UnionOptions>(options: T) {
  const discriminators = new Set<string>();
  for (const option of options) collectLiteralPaths(option, [], discriminators);

  const errorMap: z.ZodErrorMap = (issue, ctx) => {
    if (issue.code !== z.ZodIssueCode.invalid_union) {
      return { message: ctx.defaultError };
    }
    // Paths relative to the union, so nested unions don't repeat their prefix.
    const relativePath = (i: z.ZodIssue) =>
      formatZodPath(i.path.slice(issue.path.length));
    const isDiscriminatorIssue = (
      i: z.ZodIssue,
    ): i is z.ZodIssue &
      (z.ZodInvalidLiteralIssue | z.ZodInvalidEnumValueIssue) =>
      (i.code === z.ZodIssueCode.invalid_literal ||
        i.code === z.ZodIssueCode.invalid_enum_value) &&
      discriminators.has(relativePath(i));

    const ranked = options
      .map((option, index) => {
        const issues = issue.unionErrors.at(index)?.issues ?? [];
        return {
          issues,
          score: scoreBranch(option, ctx.data, [], discriminators),
          mismatches: issues.filter(isDiscriminatorIssue).length,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.mismatches - b.mismatches ||
          a.issues.length - b.issues.length,
      );
    const closest = ranked[0];
    const best = ranked.filter(branch => branch.score === closest.score);

    const mismatched = new Set(
      closest.issues.filter(isDiscriminatorIssue).map(relativePath),
    );
    const acceptedLines = [...mismatched].map(path => {
      const accepted = new Set(
        best
          .flatMap(branch => branch.issues)
          .filter(i => isDiscriminatorIssue(i) && relativePath(i) === path)
          .flatMap(i =>
            i.code === z.ZodIssueCode.invalid_literal
              ? [i.expected]
              : i.code === z.ZodIssueCode.invalid_enum_value
                ? i.options
                : [],
          )
          .map(value => JSON.stringify(value)),
      );
      const expected = `expected one of ${[...accepted].join(', ')}`;
      return path ? `${path}: ${expected}` : expected;
    });
    // With no discriminator matched, the branch is a guess, so its other
    // issues would point the agent at the wrong tile type.
    const otherLines =
      closest.score > 0 || mismatched.size === 0
        ? closest.issues
            .filter(i => !isDiscriminatorIssue(i))
            .map(i => {
              const path = relativePath(i);
              return path ? `${path}: ${i.message}` : i.message;
            })
        : [];
    return { message: [...acceptedLines, ...otherLines].join('; ') };
  };
  return z.union(options, { errorMap });
}
