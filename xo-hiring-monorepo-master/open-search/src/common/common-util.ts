/***
 * Helper functions for Integration Testing
 */
export const CommonUtil = {
  /***
   * Wait/sleep the system for required milliseconds.
   * @param milliseconds milliseconds to sleep.
   */
  waitFor: async (milliseconds: number): Promise<void> => {
    await new Promise((resolve) => {
      setTimeout(() => resolve(true), milliseconds);
    });
  },
};
