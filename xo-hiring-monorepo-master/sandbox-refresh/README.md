# Sandbox Refresh

This lambda allows you to refresh your development sandbox.

**Note, that refreshing from Salesforce Setup directly may lead to you sandbox be partially initialized.**

# Usage

List available sandboxes:

```json
{
  "action": "list"
}
```

Refresh sandbox by name:

```json
{
  "action": "refresh",
  "sandboxName": "mbenioff2"
}
```
