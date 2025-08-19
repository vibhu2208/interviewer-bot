import * as docs from '@googleapis/docs';
import Schema$Table = docs.docs_v1.Schema$Table;
import Schema$Paragraph = docs.docs_v1.Schema$Paragraph;
import Schema$Body = docs.docs_v1.Schema$Body;
import Schema$StructuralElement = docs.docs_v1.Schema$StructuralElement;

export class ContentExtraction {
  /**
   * Extract table content. The function is tailored to the specific table template
   * The header and subtitle are extracted based on the style name
   * The table body is separated into hint and content based on italic style
   *
   * Document example: https://docs.google.com/document/d/17TB-SMPIyrdUzMJ5zDmdbFmsJe19ILa93AWkVQRf4tc
   * @param element
   */
  static extractStructuredTableContent(element: Schema$Table): TableContent {
    let header = '';
    let description = '';
    const hintParts: string[] = [];
    const contentParts: string[] = [];

    element.tableRows?.forEach((row) => {
      row.tableCells?.forEach((cell) => {
        cell.content?.forEach((cellContent) => {
          if (cellContent.paragraph) {
            if (cellContent.paragraph.paragraphStyle?.namedStyleType === 'HEADING_2') {
              header = extractParagraphContent(cellContent.paragraph);
            } else if (cellContent.paragraph.paragraphStyle?.namedStyleType === 'SUBTITLE') {
              description = extractParagraphContent(cellContent.paragraph);
            } else {
              const contentSubParts: string[] = [];
              const hintSubParts: string[] = [];

              cellContent.paragraph.elements
                ?.map((el) => el.textRun)
                .forEach((txt) => {
                  if (txt) {
                    const str = txt.content?.trim() ?? '';
                    if (str.length > 0) {
                      if (txt.textStyle?.italic === true) {
                        hintSubParts.push(str);
                      } else {
                        contentSubParts.push(str);
                      }
                    }
                  }
                });

              if (contentSubParts.length > 0) {
                contentParts.push(contentSubParts.join(' '));
              }
              if (hintSubParts.length > 0) {
                hintParts.push(hintSubParts.join(' '));
              }
            }
          } else {
            console.warn(`Encountered non-paragraph element inside table, ignoring it`);
          }
        });
      });
    });

    return {
      hints: hintParts.join('\n'),
      content: contentParts.join('\n'),
      header: header,
      description: description,
    };
  }

  static extractText(body: Schema$Body | undefined): string | null {
    return body?.content?.map((el) => extractElementContent(el)).join('\n') ?? null;
  }

  /**
   * Extract table elements from the document body
   */
  static extractTables(body: Schema$Body): docs.docs_v1.Schema$Table[] {
    return (body?.content?.filter((it) => it.table != null).map((it) => it.table) as docs.docs_v1.Schema$Table[]) ?? [];
  }

  /**
   * In this method we assume specific document template
   * i.e. https://docs.google.com/document/d/17TB-SMPIyrdUzMJ5zDmdbFmsJe19ILa93AWkVQRf4tc
   * @param body
   */
  static extractSections(body: Schema$Body | undefined): TableContent[] | null {
    if (body == null) {
      return null;
    }

    try {
      const tables = ContentExtraction.extractTables(body);
      if (tables.length === 0) {
        return null;
      }
      return tables.map((it) => ContentExtraction.extractStructuredTableContent(it));
    } catch (e) {
      // It is expected situation, no need to log anything
      return null;
    }
  }
}

function extractParagraphContent(el: Schema$Paragraph): string {
  return (
    el.elements
      ?.map((it) => it.textRun?.content)
      .filter((it) => it?.trim())
      .join('') ?? ''
  );
}

function extractTableContent(el: Schema$Table): string {
  return (
    el.tableRows
      ?.map((row) => {
        return row.tableCells?.map((cell) => cell.content?.map((cnt) => extractElementContent(cnt))).join('\n');
      })
      .join('\n') ?? ''
  );
}

function extractElementContent(el: Schema$StructuralElement): string {
  if (el.paragraph) {
    return extractParagraphContent(el.paragraph);
  }
  if (el.table) {
    return extractTableContent(el.table);
  }
  return '';
}

export interface TableContent {
  header: string;
  description: string;
  hints: string;
  content: string;
}
