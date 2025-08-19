import escapeStringRegexp from 'escape-string-regexp';

export function sliceIntoChunks<T>(arr: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.slice(i, i + chunkSize);
    result.push(chunk);
  }
  return result;
}

export function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Compare strings with % syntax (i.e. '123456' like '%34%' == true)
 * @param source
 * @param pattern
 */
export function like(source: string, pattern: string): boolean {
  const regex = pattern
    .split('%')
    .map((part) => escapeStringRegexp(part)) // Escape other parts to not affect regex
    .join('.*'); // Replace % with greedy match
  return new RegExp(regex).test(source);
}

export function throwIfNull<T>(input: T | null, message: string): T {
  if (input == null) {
    throw new Error(message);
  }
  return input;
}
