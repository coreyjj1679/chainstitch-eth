/**
 * {{variable}} interpolation for block inputs.
 * Supports dot/bracket paths into previous results: {{deposit.amount}}, {{logs[0].address}}
 */

const VAR_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export class UnresolvedVariableError extends Error {
  variable: string;
  constructor(variable: string) {
    super(`Variable "${variable}" is not set. Run the block that declares it first.`);
    this.variable = variable;
    this.name = "UnresolvedVariableError";
  }
}

export function extractVariableRefs(input: string): string[] {
  const refs: string[] = [];
  for (const match of input.matchAll(VAR_PATTERN)) {
    refs.push(match[1]);
  }
  return refs;
}

function splitPath(path: string): string[] {
  // "a.b[0].c" -> ["a", "b", "0", "c"]
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((s) => s.length > 0);
}

export function resolvePath(scope: Record<string, unknown>, path: string): unknown {
  const segments = splitPath(path);
  const rootName = segments[0];
  if (!(rootName in scope)) throw new UnresolvedVariableError(rootName);
  let current: unknown = scope[rootName];
  for (const segment of segments.slice(1)) {
    if (current === null || current === undefined) {
      throw new UnresolvedVariableError(path);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Resolve an input string against the variable scope.
 * If the whole input is a single {{ref}}, the raw value is returned (preserving
 * BigInt / arrays / objects). Otherwise refs are stringified into the text.
 */
export function interpolate(input: string, scope: Record<string, unknown>): unknown {
  const trimmed = input.trim();
  const soleMatch = trimmed.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (soleMatch) return resolvePath(scope, soleMatch[1]);
  return input.replace(VAR_PATTERN, (_m, ref: string) => {
    const value = resolvePath(scope, ref);
    return typeof value === "string" ? value : String(value);
  });
}

export function isValidVariableName(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/**
 * Best-effort interpolation for display contexts (e.g. markdown blocks):
 * resolvable refs are substituted, unresolved ones are left as-is.
 */
export function interpolateLenient(
  input: string,
  scope: Record<string, unknown>,
  format: (value: unknown) => string,
): string {
  return input.replace(VAR_PATTERN, (match, ref: string) => {
    try {
      return format(resolvePath(scope, ref));
    } catch {
      return match;
    }
  });
}
