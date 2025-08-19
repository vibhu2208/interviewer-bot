## XO Reports Spreadsheet API

Google script exposed as an API.
The purpose of the script is to populate a spreadsheet with the data it receives.

### Input

JSON that contains data to be added to the spreadsheet among with the spreadsheetId and the sheetName identifies:

```

{
  spreadsheetId: '1mdFE18tf3svsd........4r4IbMB19LPnODw',
  sheetName: 'Data',
  pk: 'assignment_id',
  data: [resultSet from DB query]
}

```

### Output

Data is appended to the bottom of the sheet. New rows are only added if there are no rows with such Primary Key.
Data is added starting from the first column, following the order defined in which it was received.
It means that spreadsheet mimics the order of fields in the original SQL query.

### Deployment

```
clasp push
clasp deploy
```
