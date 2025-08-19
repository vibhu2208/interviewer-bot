# CometD Infrastructure

## Origin Request Lambda@Edge

This lambda is used to proxy cometd calls and update authorization header with service user's token.

### Configuration

The secret required to have the following fields:

```json5
{
  clientId: '...',
  clientSecret: '...',
  cometdUsername: '...',
  cometdPassword: '...',
  cometdToken: '...',
}
```

The cometd user's profile should have at least `View All Data` access.

## Origin Response Lambda@Edge

This lambda is used to set required CORS headers to responses.

## Cloudfront Distribution

Distribution for public requests.
