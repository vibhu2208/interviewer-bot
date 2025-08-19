## Overview

This lambda is related to the [LAMBDA-8523](https://rapid-engineering.atlassian.net/browse/LAMBDA-8523) task.

This lambda handles the data export triggers from the OwnBackup into the tracker DB for additional processing.

It is being called by the AWS State Machine to perform different steps of the export.
By default, you don't need to provide any input to the State Machine if you want to call it manually (just `{}`).

The steps are:

- `GetLastBackupJobStatus` - Identify the id of the last backup.
- `StartExportJob` - Start export for the specific backup.
- `IsExportJobComplete` - Wait for the specific export job to be finished.
- Additional steps after the export job is done (outside this lambda, attached to the State Machine)

### How to bypass steps

If you want to bypass previous steps and directly move to specific one, execute State Machine with the following input:

```json5
{
  backupJobId: 123, // Include this field to bypass GetLastBackupJobStatus
  isBackupJobComplete: true, // Include this field to bypass GetLastBackupJobStatus
  isBackupJobTimeout: false, // Include this field to bypass GetLastBackupJobStatus
  exportJobId: 321, // Include this field to bypass StartExportJob
  isExportJobComplete: true, // Include this field to bypass IsExportJobComplete
}
```

## Configuration

This lambda expects to have `AWS_REGION` and `SECRETS_KEY` env variables defined.
These variables are used to locate the proper secret in the SecretsManager.
Inside this secret the following pair should be defined:

```
Key: OWNBACKUP_DATA
Value (json):
{
  "endpointId": 123;    // Export endpoint id
  "serviceId": 321;     // Backup service id
  "username": "string";
  "password": "string";
}
```

## Deployment

Part of the CDK deployment.
