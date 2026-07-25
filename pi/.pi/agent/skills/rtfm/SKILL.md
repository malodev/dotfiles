---
name: rtfm
description: When debugging errors from third-party APIs, libraries, or services (HTTP 4xx/5xx, SDK failures, CLI tool errors, auth issues), stop and consult the official documentation before retrying or guessing. Triggers on repeated failure patterns, API error codes, endpoint debugging, or when the user says "did you read the docs?", "check the manual", or "RTFM".
---

# Read The Docs Before Debugging

## The rule

When you hit an error from a third-party system — API, library, CLI tool, service — your first instinct must be:

1. **Stop.** Do not retry with variations of the same approach.
2. **Go to the official docs.** Find the current documentation for what you're calling.
3. **Check for recent changes.** APIs change. Endpoints get deprecated. Parameter formats shift. What worked last year may not work now.
4. **Read the error.** A 403 is not the same as a 401. A 400 has a different cause than a 404. Don't lump them together.
5. **Only then try again** with the corrected approach.

## When this triggers

This skill activates when:
- You are debugging errors from an external API/service/library
- You have retried the same thing more than twice with the same error
- HTTP error codes are involved (400, 401, 403, 404, 429, 500, etc.)
- The user tells you to check the manual/docs
- You're about to blame permissions/scopes/auth when the real issue might be the endpoint or request format

## Anti-patterns this prevents

- Retrying a deprecated endpoint 8 times while blaming "Dev Mode restrictions"
- Guessing at parameter formats instead of checking the API reference
- Assuming how an API worked a year ago is how it works today
- Adding unnecessary complexity (PKCE vs client_secret, different ports, different client IDs) when the call itself is wrong

## Real example

Spotify Web API, June 2026:
- `POST /v1/users/{id}/playlists` was removed in Feb 2026
- New endpoint: `POST /v1/me/playlists`
- New add-tracks endpoint: `POST /v1/playlists/{id}/items`
- New format: `{"uris": [...]}` (not `{"items": [...]}`)

Checking the docs at `developer.spotify.com/documentation` would have revealed this in 2 minutes instead of 30 minutes of retries.

## The workflow

```
Error from external system
        │
        ▼
   ┌─────────────┐
   │ STOP.        │
   │ Do NOT retry │
   └──────┬──────┘
          │
          ▼
   ┌──────────────────────┐
   │ Go to official docs   │
   │ Find the exact        │
   │ endpoint/tool/API ref │
   └──────┬───────────────┘
          │
          ▼
   ┌──────────────────────┐
   │ Check:                │
   │ - Is this endpoint    │
   │   still valid?        │
   │ - Have params changed?│
   │ - Is there a changelog│
   │   or migration guide? │
   └──────┬───────────────┘
          │
          ▼
   ┌──────────────────────┐
   │ Fix the call based on │
   │ what the docs say NOW │
   │ (not what you remember│
   │  from before)         │
   └──────────────────────┘
```

## Scope

This applies to **all** third-party integrations:
- REST APIs (Spotify, GitHub, Stripe, etc.)
- SDKs and libraries
- CLI tools with their own config/credentials
- Cloud services (AWS, GCP, Azure)
- Databases and their drivers
- Any external system with documentation
