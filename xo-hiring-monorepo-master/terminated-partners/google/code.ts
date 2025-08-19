/**
 * Publicly exposed API Endpoint. Loads data into the spreadsheet
 * @param e contains:
 *    data - the rows to be added to the spreadsheet,
 *    spreadsheetId and the sheetName - identifiers of the sheet to be updated,
 *    pk - name of the unique column in the dataset
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function doPost(e) {
  const request = JSON.parse(e.postData.contents);
  const spreadsheetId = request.spreadsheetId;
  const inputData = request.data;
  const dataSheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(request.sheetName);
  addRows(dataSheet, inputData, request.pk, spreadsheetId);
  return ContentService.createTextOutput();
}

/**
 * Adds rows to the sheet.
 * @param dataSheet
 * @param inputData
 * @param pk
 * @param spreadsheetId
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function addRows(dataSheet, inputData, pk, spreadsheetId) {
  const pkId = Object.keys(inputData[0]).indexOf(pk);
  const dataRangeValues = dataSheet.getDataRange().getValues();
  const ids = dataRangeValues.map(function (dataRangeRow) {
    if (dataRangeRow[pkId] !== '') return dataRangeRow[pkId];
  });
  const rows = [];
  for (let i = 0; i < inputData.length; i++) {
    if (ids.indexOf(inputData[i][pk]) === -1) {
      rows.push(
        Object.keys(inputData[i]).map(function (key) {
          return inputData[i][key];
        }),
      );
    }
  }
  if (rows.length > 0) {
    dataSheet.getRange(dataRangeValues.length + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}
