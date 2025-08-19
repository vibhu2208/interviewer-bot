import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame
import boto3
from datetime import datetime
import re

# Initialize Glue job
args = getResolvedOptions(sys.argv, ['JOB_NAME', 'exportManifest', 'bucketName', 'tableName', 'databaseName'])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)
logger = glueContext.get_logger()

# Inputs
# DDB S3 Export Arn (like 'dynamodb-export/xo-hiring-interview-bot-sandbox-main/AWSDynamoDB/01742912651567-2103baf3/manifest-summary.json')
exportManifest = args['exportManifest']
databaseName = args['databaseName']
tableName = args['tableName']
bucketName = args['bucketName']

logger.info(f"Export Manifest: {exportManifest}")
logger.info(f"Target DB: {databaseName}")
logger.info(f"Target Table: {tableName}")

# Replace manifest-summary.json with data/ in the export path
s3ExportPath = exportManifest.rsplit('/', 1)[0] + '/data/'
logger.info(f"S3 Export Path: {s3ExportPath}")
s3CatalogPath = f"{'/'.join(exportManifest.split('/')[:2])}/catalog-data/"

# Define the S3 path for JSON data
s3InputPath = f"s3://{bucketName}/{s3ExportPath}"
s3OutputPath = f"s3://{bucketName}/{s3CatalogPath}"

logger.info(f"Reading DynamoDB JSON data from: {s3InputPath}")

# Read the DynamoDB JSON data
dynamicFrame = glueContext.create_dynamic_frame.from_options(
    connection_type="s3",
    connection_options={"paths": [s3InputPath]},
    format="json"
)

recordCount = dynamicFrame.count()
logger.info(f"Successfully read {recordCount} records from DynamoDB JSON data")

# Configure Spark to handle problematic decimal types
spark.conf.set("spark.sql.parquet.writeLegacyFormat", "true")
spark.conf.set("spark.sql.parquet.enableTypeCoercion", "false")
spark.conf.set("spark.sql.decimalOperations.allowPrecisionLoss", "true")

# Convert DynamoDB JSON to standard format
logger.info("Converting DynamoDB JSON to standard JSON format")
dynamicFrame = dynamicFrame.simplify_ddb_json()

# Write to S3 in Parquet format AND create a table in the Glue Data Catalog
logger.info(f"S3 Output Path: {s3OutputPath}")
logger.info(f"Writing data to S3 and creating table {databaseName}.{tableName}")
sink = glueContext.getSink(
    connection_type="s3",
    path=s3OutputPath,
    compression="snappy",
    enableUpdateCatalog=True,
    updateBehavior="UPDATE_IN_DATABASE"
)

# Set catalog info
sink.setCatalogInfo(
    catalogDatabase=databaseName,
    catalogTableName=tableName
)

# Set format and write options
sink.setFormat("parquet", useGlueParquetWriter=True)
sink.writeFrame(dynamicFrame)

logger.info(f"Successfully wrote data and created table {databaseName}.{tableName}")

# Cleanup old files
logger.info("Starting cleanup of old files")
s3_client = boto3.client('s3')

# List all objects in the output directory
response = s3_client.list_objects_v2(
    Bucket=bucketName,
    Prefix=s3CatalogPath
)

if 'Contents' in response:
    # Group files by their prefix (timestamp)
    file_groups = {}
    for obj in response['Contents']:
        # Extract the timestamp prefix using regex
        match = re.match(r'.*?run-(\d+)-part-block.*', obj['Key'])
        if match:
            timestamp = match.group(1)
            if timestamp not in file_groups:
                file_groups[timestamp] = []
            file_groups[timestamp].append(obj['Key'])

    if file_groups:
        # Skip cleanup if this is the first run (only one file group)
        if len(file_groups) <= 1:
            logger.info("Skipping cleanup as this appears to be the first run (only one file group)")
        else:
            # Find the oldest timestamp
            oldest_timestamp = min(file_groups.keys())
            logger.info(f"Found oldest timestamp: {oldest_timestamp}")

            # Delete all files with the oldest timestamp
            for file_key in file_groups[oldest_timestamp]:
                s3_client.delete_object(
                    Bucket=bucketName,
                    Key=file_key
                )
                logger.info(f"Deleted old file: {file_key}")

            logger.info(f"Successfully cleaned up {len(file_groups[oldest_timestamp])} old files")
    else:
        logger.info("No files found to clean up")
else:
    logger.info("No files found in the output directory")

logger.info("Job execution completed")
job.commit()
