import { Auth, google, sheets_v4 } from 'googleapis';
import { z } from 'zod';
import _ from 'lodash';
import moment from 'moment';
import { EnvConfig, ProcessEnvConfig } from './env';

const userEnteredValueType = z
  .object({
    boolValue: z.boolean().optional(),
    errorValue: z.object({}).passthrough().optional(),
    numberValue: z.number().optional(),
    formulaValue: z.string().optional(),
    stringValue: z.string().optional(),
  })
  .passthrough()
  .optional();

type UserEnteredValue = z.infer<typeof userEnteredValueType>;

const templateSheetDataType = z.object({
  properties: z.object({
    gridProperties: z
      .object({
        frozenRowCount: z.number(),
      })
      .passthrough(),
  }),
  // tuple of 1 element, since we are always requesting a full sheet, not parts of sheet
  data: z.tuple([
    z.object({
      columnMetadata: z.array(
        z.object({
          pixelSize: z.number(),
        }),
      ),
      rowData: z.array(
        z.object({
          values: z.array(
            z.object({
              userEnteredFormat: z.object({}).passthrough().optional(),
              userEnteredValue: userEnteredValueType,
            }),
          ),
        }),
      ),
    }),
  ]),
  conditionalFormats: z.tuple([
    z
      .object({
        ranges: z.array(
          z.object({
            endColumnIndex: z.number().optional(),
            endRowIndex: z.number().optional(),
            sheetId: z.number().optional(),
            startColumnIndex: z.number(),
            startRowIndex: z.number().optional(),
          }),
        ),
      })
      .passthrough(),
  ]),
});

type TemplateSheetData = z.infer<typeof templateSheetDataType>;

const targetSheetDataType = z.object({
  properties: z.object({ sheetId: z.number() }),
});

type WeekTable = {
  weekStart: string;
  firstRowIndex: number;

  header: sheets_v4.Schema$RowData;
  rows: sheets_v4.Schema$RowData[];
  footer: sheets_v4.Schema$RowData[];
};

const firstDataRowIndex = (table: WeekTable) => table.firstRowIndex + 1;

const lastDataRowIndex = (table: WeekTable) => firstDataRowIndex(table) + table.rows.length - 1;

const sumRowIndex = (table: WeekTable) => lastDataRowIndex(table) + 2;

const lastRowIndex = (table: WeekTable) => sumRowIndex(table) + 2;

function* allTableRows(table: WeekTable) {
  yield table.header;
  yield* table.rows;
  yield* table.footer;
}

function* allTablesRows(tables: Iterable<WeekTable>) {
  for (const table of tables) {
    yield* allTableRows(table);
  }
}

function* getWeekTables(data: SheetData, templateSheetData: TemplateSheetData): Generator<WeekTable, void, undefined> {
  const templateDataRowValues = templateSheetData.data[0].rowData[1].values;
  const templateSumRowValues = templateSheetData.data[0].rowData[3].values;

  const newTable = (rowWeekStart: string, firstRowIndex: number) => {
    return {
      weekStart: rowWeekStart,
      firstRowIndex,
      header: {
        values: [
          // first column is hidden
          {},
          {
            userEnteredFormat: { textFormat: { bold: true } },
            userEnteredValue: { stringValue: rowWeekStart },
          },
        ],
      },
      rows: [],
      footer: [],
    };
  };

  const generateFooter = (table: WeekTable) => {
    table.footer.push({});

    const rowData: { values: sheets_v4.Schema$CellData[] } = { values: [] };
    for (const templateSumRowCell of templateSumRowValues) {
      const cell = _.cloneDeep(templateSumRowCell);
      if (cell.userEnteredValue?.stringValue == '#weekStart') {
        cell.userEnteredValue.stringValue = table.weekStart;
      } else if (cell.userEnteredValue?.stringValue == '#weekEnd') {
        cell.userEnteredValue.stringValue = moment(table.weekStart).add(6, 'days').format('YYYY-MM-DD');
      } else if (cell.userEnteredValue?.formulaValue) {
        // Replace column aggregates
        cell.userEnteredValue.formulaValue = cell.userEnteredValue.formulaValue
          // Column range in template, e.g. I2, Q2, AA2, etc.
          .replace(/=([A-Z]+)\(([A-Z]+)2\)/, `=$1($2${firstDataRowIndex(table) + 1}:$2${lastDataRowIndex(table) + 1})`)
          // Sum row fields in template, e.g. I4, Q4, AA4, etc.
          .replace(/\b([A-Z]+)4\b/g, `$1${sumRowIndex(table) + 1}`);
      }
      rowData.values.push(cell);
    }

    table.footer.push(rowData);
    table.footer.push({});
    table.footer.push({});
  };

  const convertType: (athenaType: string, athenaValue: string) => UserEnteredValue = (
    athenaType: string,
    athenaValue: string,
  ) => {
    const t = athenaType.toLowerCase();

    if (['int', 'integer', 'smallint', 'tinyint', 'bigint', 'double', 'float', 'decimal'].indexOf(t) >= 0) {
      return {
        numberValue: Number(athenaValue),
      };
    }

    if (['boolean'].indexOf(t) >= 0) {
      return {
        boolValue: Boolean(athenaValue),
      };
    }
    return {
      stringValue: String(athenaValue),
    };
  };

  let current: WeekTable | null = null;
  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i];
    const rowWeekStart = row[5];
    if (!rowWeekStart.match(/\d+-\d\d-\d\d/)) {
      throw new Error(`Unexpected "Week Start" value: ${rowWeekStart}`);
    }

    // initialize first table
    if (current == null) {
      current = newTable(rowWeekStart, 1);
    }

    // yield previous table, if week has ended
    if (rowWeekStart != current.weekStart) {
      generateFooter(current);
      yield current;
      const firstRowIndex = lastRowIndex(current) + 1;
      current = newTable(rowWeekStart, firstRowIndex);
    }

    // update table row data
    current.rows.push({
      values: row.map((cell, index) => ({
        userEnteredFormat: templateDataRowValues[index].userEnteredFormat,
        userEnteredValue: convertType(data.columnTypes[index], cell),
      })),
    });
  }

  // yield last table
  if (current != null) {
    generateFooter(current);
    yield current;
  }
}

function* editSheet(
  templateSheet: sheets_v4.Schema$Sheet,
  targetSheet: sheets_v4.Schema$Sheet,
  data: SheetData,
): Generator<sheets_v4.Schema$Request, void, undefined> {
  // validate sheet properties
  const templateSheetData = templateSheetDataType.parse(templateSheet);
  const targetSheetData = targetSheetDataType.parse(targetSheet);
  const sheetId = targetSheetData.properties.sheetId;

  // Delete old rows
  yield {
    // This operation moves all the conditional formatting below the cut
    insertDimension: {
      inheritFromBefore: true,
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: 1,
        endIndex: 2,
      },
    },
  };

  yield {
    // This operation cuts the old data
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { rowCount: templateSheetData.properties.gridProperties.frozenRowCount + 1 },
      },
      fields: 'gridProperties.rowCount',
    },
  };

  // Copy sheet settings
  yield {
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: templateSheetData.properties.gridProperties,
      },
      fields: 'gridProperties',
    },
  };

  // Update spreadsheet properties
  yield {
    updateSpreadsheetProperties: {
      properties: {
        title: data.title,
      },
      fields: 'title',
    },
  };

  // Apply header formatting
  const headerRow = templateSheetData.data[0].rowData[0];
  yield {
    updateCells: {
      start: {
        sheetId,
        rowIndex: 0,
        columnIndex: 0,
      },
      rows: [headerRow],
      fields: 'userEnteredFormat,userEnteredValue',
    },
  };

  // set column widths
  const columnWidths = templateSheetData.data[0].columnMetadata.map((c) => c.pixelSize);
  for (let columnIndex = 0; columnIndex < columnWidths.length; columnIndex++) {
    yield {
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: columnIndex,
          endIndex: columnIndex + 1,
        },
        properties: {
          pixelSize: columnWidths[columnIndex],
        },
        fields: 'pixelSize',
      },
    };
  }

  // hide first column
  yield {
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: 1,
      },
      properties: {
        hiddenByUser: true,
      },
      fields: 'hiddenByUser',
    },
  };

  // Write rows
  const weekTables = [...getWeekTables(data, templateSheetData)];
  yield {
    updateCells: {
      start: {
        sheetId,
        rowIndex: 1,
        columnIndex: 0,
      },
      rows: [...allTablesRows(weekTables)],
      fields: 'userEnteredFormat,userEnteredValue',
    },
  };

  // copy conditional formatting rule, but re-define ranges
  // one rule per table's column
  for (const table of weekTables) {
    for (const templateRange of templateSheetData.conditionalFormats[0].ranges) {
      yield {
        addConditionalFormatRule: {
          rule: {
            ...templateSheetData.conditionalFormats[0],
            ranges: [
              {
                sheetId,
                startColumnIndex: templateRange.startColumnIndex,
                endColumnIndex: templateRange.startColumnIndex + 1,
                startRowIndex: firstDataRowIndex(table),
                endRowIndex: lastDataRowIndex(table) + 1,
              },
            ],
          },
        },
      };
    }
  }
}

type SheetData = {
  title: string;
  columnTypes: string[];
  rows: string[][];
};

async function getSheet(
  sheetsService: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  range: string | undefined,
  includeGridData: boolean,
): Promise<sheets_v4.Schema$Sheet> {
  const spreadsheetResp = await sheetsService.spreadsheets.get({
    spreadsheetId: spreadsheetId,
    ranges: range === undefined ? undefined : [range],
    includeGridData,
  });

  const sheet = spreadsheetResp.data?.sheets?.find((s) => s.properties?.sheetId === sheetId);

  if (sheet === undefined) {
    throw new Error(
      `Unable to find sheet ${sheetId} in spreadsheet ${spreadsheetId}. Response status was ${spreadsheetResp.status}.`,
    );
  }

  return sheet;
}

async function createNewSpreadsheet(auth: Auth.GoogleAuth): Promise<{ spreadsheetId: string; sheetId: number }> {
  console.log('Creating target sheet...');

  const sheetsService = google.sheets({ version: 'v4', auth: auth });

  const driveService = google.drive({ version: 'v3', auth: auth });

  const createResult = await sheetsService.spreadsheets.create({});
  const spreadsheetId = createResult.data.spreadsheetId;
  const sheetId = createResult.data.sheets?.[0].properties?.sheetId;
  if (!spreadsheetId || sheetId == null || sheetId == undefined) {
    throw new Error(`Unable to create spreadsheet: \n${JSON.stringify(createResult, null, 2)}`);
  }

  const grantResult = await driveService.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      role: 'commenter',
      type: 'anyone',
    },
  });
  if (grantResult.status >= 400) {
    throw new Error(`Unable to share spreadsheet: \n${JSON.stringify(grantResult, null, 2)}`);
  }

  console.log(`SPREADSHEET URL: ${createResult.data.spreadsheetUrl}`);

  return {
    spreadsheetId,
    sheetId,
  };
}

export async function renderSheet(envConfig: EnvConfig, processEnv: ProcessEnvConfig, data: SheetData) {
  const auth = new Auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
    credentials: {
      private_key: envConfig.googleAuthPrivateKey,
      client_email: envConfig.googleAuthClientEmail,
    },
  });
  const sheetsService = google.sheets({ version: 'v4', auth: auth });

  const target = processEnv.TARGET_SPREADSHEET_ID
    ? { spreadsheetId: processEnv.TARGET_SPREADSHEET_ID, sheetId: processEnv.TARGET_SHEET_ID }
    : await createNewSpreadsheet(auth);

  console.log('Loading target sheet...');
  const targetSheet = await getSheet(sheetsService, target.spreadsheetId, target.sheetId, undefined, false);

  console.log('Loading template sheet...');
  const templateSheet = await getSheet(
    sheetsService,
    envConfig.templateSpreadsheetId,
    envConfig.templateSheetId,
    envConfig.templateSheetRange,
    true,
  );

  const requests = [...editSheet(templateSheet, targetSheet, data)];
  console.log(`Starting rendering of ${requests.length} requests`);

  const result = await sheetsService.spreadsheets.batchUpdate({
    spreadsheetId: target.spreadsheetId,
    requestBody: {
      requests: requests,
    },
  });

  console.log(result.status);
}
