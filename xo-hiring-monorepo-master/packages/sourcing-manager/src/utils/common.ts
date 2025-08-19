export const LLMProjectName = 'sourcing';

/**
 * Group an array of items by a key. Null key values are ignored.
 * @param array
 * @param key
 */
export function groupBy<T>(array: T[], key: (item: T) => string | null): Record<string, T[]> {
  return array.reduce((result, currentItem) => {
    const groupKey = key(currentItem);
    if (groupKey == null) {
      return result;
    }
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(currentItem);
    return result;
  }, {} as Record<string, T[]>);
}

/**
 * Split an array into chunks of a given size
 * @param array
 * @param chunkSize
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
