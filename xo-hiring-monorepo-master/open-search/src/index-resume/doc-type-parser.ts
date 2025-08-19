import { fromBuffer } from 'file-type';
import { ContentType } from 'aws-sdk/clients/s3';
import { MimeType } from './mime-type';
import { S3Resource } from '../common/s3-utils';

const PDF = 'pdf';
const DOC = 'doc';
const DOCX = 'docx';
const EXTENSION_FIELD = 'original-file-extension';

export class DocumentTypeParser {
  async defineContentType(resource: S3Resource): Promise<ContentType | undefined> {
    const { metadata, data } = resource;
    const extension = metadata?.[EXTENSION_FIELD] ?? null;

    let contentType;
    switch (extension) {
      case PDF:
        contentType = MimeType.PDF;
        break;
      case DOC:
        contentType = MimeType.MS_WORD;
        break;
      case DOCX:
        contentType = MimeType.WORDPROCESSINGML_DOC;
        break;
      default:
        console.log(`Empty or unknown file extension: ${extension}`);
    }

    if (!contentType) {
      console.log('Trying to define content type');
      const fileTypeResult = await fromBuffer(data);
      if (fileTypeResult) {
        console.log(`Defined document MIME type: ${fileTypeResult.mime}`);
        return fileTypeResult.mime;
      } else {
        console.warn('Could not define document MIME type');
      }
    }

    return contentType;
  }
}
