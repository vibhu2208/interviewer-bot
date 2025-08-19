export class MimeType {
  public static readonly PDF = 'application/pdf';

  public static readonly OPEN_XML_FORMATS = 'application/vnd.openxmlformats';
  public static readonly WORDPROCESSINGML_DOC =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  public static readonly MS_WORD = 'application/msword';
  public static readonly X_CFB = 'application/x-cfb';
  public static readonly APP_OCTET_STREAM = 'application/octet-stream';
  public static readonly BINARY_OCTET_STREAM = 'binary/octet-stream';

  public static isOctetStream(mime: string): boolean {
    return [MimeType.APP_OCTET_STREAM, MimeType.BINARY_OCTET_STREAM].includes(mime);
  }
}
