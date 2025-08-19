import pdf from 'pdf-parse';

export class PdfParser {
  async getTextContent(data: Buffer): Promise<string> {
    const { text } = await pdf(data);

    console.log(`Successfully parsed PDF document`);
    return text;
  }
}
