import WordExtractor from 'word-extractor';

export class DocParser {
  async getTextContent(data: Buffer): Promise<string> {
    const extractor = new WordExtractor();
    const extracted = await extractor.extract(data);

    console.log(`Successfully parsed DOC document`);
    return extracted.getBody();
  }
}
