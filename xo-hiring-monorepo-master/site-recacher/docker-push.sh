#!/usr/bin/env bash

set -e

AWS_ACCOUNT=104042860393
AWS_REGION=us-east-1
AWS_ECR_URL=$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
AWS_ECR_REPO=xo-hiring-site-recacher

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ECR_URL

docker build --build-arg TRILOGY_PACKAGES_TOKEN=$TRILOGY_PACKAGES_TOKEN -t xo-hiring-site-recacher .

docker tag xo-hiring-site-recacher:latest $AWS_ECR_URL/$AWS_ECR_REPO:latest

docker push $AWS_ECR_URL/$AWS_ECR_REPO:latest