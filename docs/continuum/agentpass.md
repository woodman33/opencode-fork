# AgentPass Authentication

## Overview

AgentPass handles authentication, API key management, and rate limiting for the Continuum platform. It provides a unified auth layer for both human users and AI agents.

## Features

- **API Key Management** — Create, rotate, and revoke API keys
- **Rate Limiting** — Per-key and per-user rate limits using Cloudflare KV
- **Agent Identity** — Unique identifiers for each agent instance
- **Usage Tracking** — Token and request counting per key
- **Team Support** — Shared keys with role-based access

## Architecture

```
┌───────────────────────────────────────┐
│           AgentPass                    │
├───────────────────────────────────────┤
│                                        │
│  Request ──▶ Validate Key              │
│                  │                     │
│                  ▼                     │
│          Check Rate Limit              │
│                  │                     │
│                  ▼                     │
│          Track Usage                   │
│                  │                     │
│                  ▼                     │
│          Forward to Service            │
│                                        │
│  Storage:                              │
│  ┌──────────┐  ┌──────────────────┐   │
│  │ KV Store │  │ Durable Object   │   │
│  │ (Keys,   │  │ (Usage Counter,  │   │
│  │  Limits) │  │  Rate Windows)   │   │
│  └──────────┘  └──────────────────┘   │
│                                        │
└───────────────────────────────────────┘
```

## Key Format

```
ocp_<environment>_<random>

Examples:
ocp_live_a1b2c3d4e5f6g7h8
ocp_test_x9y8z7w6v5u4t3s2
```

## API Reference

### Create Key

```bash
curl -X POST https://auth.continuum.dev/keys \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Agent",
    "permissions": ["chat", "code-gen", "deploy"],
    "rateLimit": { "requests": 1000, "window": "1h" },
    "models": ["anthropic/*", "openai/gpt-4o"]
  }'
```

### Validate Key (Middleware)

```typescript
async function validateKey(request: Request, env: Env): Promise<KeyInfo | null> {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ocp_")) return null

  const key = authHeader.slice(7)
  const keyInfo = await env.KEYS_KV.get<KeyInfo>(key, "json")

  if (!keyInfo || keyInfo.revokedAt) return null
  if (keyInfo.expiresAt && Date.now() > keyInfo.expiresAt) return null

  return keyInfo
}
```

### Rate Limiting

```typescript
async function checkRateLimit(keyId: string, env: Env): Promise<boolean> {
  const counter = env.RATE_LIMITER.getByName(keyId)
  const allowed = await counter.check()
  return allowed
}
```

## Integration with OpenCode

AgentPass keys can be used to authenticate OpenCode sessions:

```json
{
  "provider": {
    "continuum": {
      "options": {
        "apiKey": "env:CONTINUUM_API_KEY",
        "baseURL": "https://api.continuum.dev/v1"
      }
    }
  }
}
```

## Tally Integration

AgentPass uses Tally forms for:
- **Waitlist signups** — Collect early access requests
- **API key requests** — Qualify and approve key requests
- **Feedback** — Collect usage feedback from agents and users

```typescript
// Webhook handler for Tally form submissions
async function handleTallyWebhook(request: Request, env: Env) {
  const payload = await request.json()

  if (payload.formId === "waitlist-form-id") {
    await env.WAITLIST_KV.put(payload.fields.email, JSON.stringify({
      name: payload.fields.name,
      useCase: payload.fields.use_case,
      submittedAt: Date.now(),
    }))
  }

  return new Response("ok")
}
```
