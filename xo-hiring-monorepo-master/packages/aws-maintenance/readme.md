## AWS Maintenance Scripts

This package contains scripts designed to help maintain and clean up AWS resources associated with the XO environments.

### Available Scripts

There are two main scripts available:

1.  **CloudWatch Logs Cleanup (`npm run clean-logs`)**
2.  **Stale Resources Cleanup (`npm run clean-stale`)**

---

### 1. CloudWatch Logs Cleanup

**Command:** `npm run clean-logs`

**Description:**
This script focuses on managing CloudWatch log groups to optimize storage and maintain relevant log data. It performs the following actions:

- **Preview Environments:** Log groups associated with preview environments (e.g., from pull requests) that are older than 7 days are deleted.
- **Sandbox Environments:** Log groups for sandbox environments have their retention policy set to 120 days if not already configured.
- **Production Environments:** Log groups for production environments have their retention policy set to 180 days if not already configured.
- **Unclassified/Other Environments:** If a log group cannot be clearly classified, its retention policy is set to 180 days (production default) if not already configured.
- **Old & Empty Log Groups:** Log groups older than 180 days that contain no log streams (i.e., are empty) are deleted.

**Configuration:**

- **AWS Access:** Requires your AWS profile to be configured with necessary permissions to describe, delete log groups, and put retention policies in CloudWatch Logs. (e.g., `CloudWatchLogsFullAccess` or a more restricted policy with equivalent permissions).

---

### 2. Stale Resources Cleanup

**Command:** `npm run clean-stale`

**Description:**
This script is designed to identify and remove AWS resources that were provisioned for preview environments (typically associated with pull requests) and are no longer needed. Specifically, it targets resources for which the corresponding GitHub Pull Request has been closed or merged. This helps in reducing clutter and costs.

The script checks the status of pull requests across the following repositories:

- `ws-frontend-monorepo`
- `xo-hiring-monorepo`
- `xo-hiring-admin`
- `xo-job-recommender`

It then proceeds to delete the following types of stale resources if their associated PR is closed:

- **CloudFormation Stacks:** Deletes stacks created for preview environments. Retries deletion for stacks in `DELETE_FAILED` state.
- **S3 Buckets:** Empties and deletes S3 buckets created for preview environments.
- **IAM Roles:** Deletes IAM roles (and their associated inline/attached policies) created for preview environments.
- **CloudFront Distributions:** Disables and then deletes CloudFront distributions associated with preview environments. If a distribution is not in a 'Deployed' state, it will be disabled first, and the script might need to be re-run later to complete the deletion.
- **API Gateway REST APIs:** Deletes REST APIs created for preview environments.
- **SSM Parameters:** Deletes SSM parameters under the `/xo-hiring` path that are associated with preview environments.
- **Lambda Functions:** Deletes Lambda functions created for preview environments. Edge Lambda functions (replicated functions) cannot be deleted by this script and will be skipped with a warning.

**Configuration:**

1.  **AWS Access:**

    - Requires your AWS profile to be configured with permissions to list and delete the resources mentioned above across various services (CloudFormation, S3, IAM, CloudFront, API Gateway, SSM, Lambda).
    - Due to the broad range of services, a role with extensive permissions (like `AdministratorAccess`) might be easiest, but for production use, a more granular policy is recommended.

2.  **GitHub Token:**
    - A GitHub Personal Access Token (PAT) is required to check the status of pull requests.
    - The token needs `repo` scope, or at least `public_repo` and `read:org` if all repositories are public and you need to read organization details. It specifically needs read access to pull requests for the repositories listed above, under the `trilogy-group` owner.
    - Create a `.env` file in the `packages/aws-maintenance` directory (you can copy from `.env.template` if it exists).
    - Add your GitHub token to the `.env` file like this:
      ```
      GITHUB_TOKEN=your_github_pat_here
      ```
