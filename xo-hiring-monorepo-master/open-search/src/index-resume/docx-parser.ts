import mammoth from 'mammoth';

export class DocxParser {
  async getTextContent(data: Buffer): Promise<string> {
    const text = await mammoth.extractRawText({ buffer: data });

    console.log(`Successfully parsed DOCX document`);
    return text.value;
  }
}
