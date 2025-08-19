export class StringUtils {
  /**
   * Replaces new line symbols with a single space; replace a few consequent separator symbols with a single space
   * @param input
   */
  static normalize(input: string | undefined): string | undefined {
    return input ? input.replace(/\s+/g, ' ').trim() : input;
  }
}
