# Watcher

Lambda function, which is on duty, when you sleep.

It handles errors from SNS topics, such as:

- `xo-hire-failures`
- `xo-hire-stats-tracker-failures`
- `xo-hiring-cicd-failures`

and takes action, such as:

- creates JIRA ticket
- logs them
