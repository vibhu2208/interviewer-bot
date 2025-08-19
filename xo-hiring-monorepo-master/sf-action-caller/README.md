# xo-hire-action-caller

## Adding actions

The implementation of current actions could be found in `dispatch()` in `index.ts`.

EventBridge actions are encoded in its rules' names. Rule name should have the following format:
`xo-hire-action-caller_<action-name>`. E.g. `xo-hire-action-caller_LaunchProcessRawApplications` will
be recognized as an `LaunchProcessRawApplications` action.

## Running locally

1. In `action-caller/` run `npm install` and then run `npm run build`
2. Make a copy of `test/debug.sample.js` to `test/debug.js`
3. Populate credentials there
4. Run it

## Deployment

Prerequisites: AWS CLI must be set up for access to `RAM-AWS-CrossOver-Admin`.

Run `deploy/deploy.sh` to deploy `xo-hire-action-caller-sandbox`.

Run `deploy/deploy-prod.sh` to deploy `xo-hire-action-caller`.
