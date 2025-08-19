import sys
import boto3
import os
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from multiprocessing.pool import ThreadPool

args = getResolvedOptions(sys.argv, ['JOB_NAME', 'bucketName', 'targetDir', 'sourceDirPrefix'])

bucketName = args['bucketName']
sourceDirPrefix = args['sourceDirPrefix']
targetDir = args['targetDir'] + '/'
tempDir = "gluetempdir/"

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session

logger = glueContext.get_logger()


def latest_xo_hire_backup_path():
    s3 = boto3.client('s3')
    commonPrefixes = s3.list_objects(Bucket=bucketName, Prefix=sourceDirPrefix, Delimiter='/').get('CommonPrefixes')
    if (commonPrefixes is None):
        return None
    prefixes = list(map(lambda o: o.get('Prefix'), commonPrefixes))
    return max(prefixes)
    
s3_backup_root_path = latest_xo_hire_backup_path()  
if (s3_backup_root_path is None):
    quit()

s3 = boto3.resource('s3')
s3.Bucket(bucketName).objects.filter(Prefix=tempDir).delete()

def tableNameFromFilepath(path):
    return path.split("/")[-1].replace('ies.csv.gz','y',1).replace('s.csv.gz','',1)
    
allBackupFiles = list(map(lambda x:x.key, list(s3.Bucket(bucketName).objects.filter(Prefix=s3_backup_root_path).all())))
csvBackupFiles = list(filter(lambda path: path.endswith('.csv.gz'),  allBackupFiles))
tables = list(map(lambda path:[tableNameFromFilepath(path), path], csvBackupFiles))

def convert(table):
    destination_path = 's3://' + bucketName + '/' + tempDir + table[0] + '/'
    source_path = 's3://' + bucketName + '/' + table[1]
    df = spark.read.option('delimiter',',').option('escape', '"').option('header','true').option("inferSchema", "true").option('multiLine','true').csv(source_path)
    df.write.mode("overwrite").format('orc').option('compression', 'snappy').save(destination_path)

logger.info("convert job started")
with ThreadPool(20) as t:
    t.map(convert, tables)
logger.info("convert job ended")

sync_command = f"aws s3 sync s3://{bucketName}/{tempDir} s3://{bucketName}/{targetDir} --delete"

logger.info("sync job started")
os.system(sync_command)
logger.info("sync job ended")