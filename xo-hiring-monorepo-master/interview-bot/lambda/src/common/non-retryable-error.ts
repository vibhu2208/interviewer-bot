/**
 * This is an error that is 'expected' to occur
 * It indicates incorrect, but expected, state of the something
 * Should not trigger re-processing and just fail processing gracefully
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}
