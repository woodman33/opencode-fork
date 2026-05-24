# Cloudflare Agent Setup

## Overview

The Cloudflare Agent package (`@opencode-ai/cloudflare-agent`) deploys OpenCode's AI coding capabilities to Cloudflare's edge network using Durable Objects for persistent state and the Agents SDK for real-time communication.

## Architecture

```
Client (TUI/Web/Desktop)
    │
    │ WebSocket / HTTP
    ▼
┌─────────────────────────┐
│   Cloudflare Worker      │
│   (Entry Point)          │
├─────────────────────────┤
│   routeAgentRequest()    │
│   /agents/:class/:name   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   CodingAgent            │
│   (Durable Object)       │
├─────────────────────────┤
│   State:                 │
│   - messages[]           │
│   - model selection      │
│   - task history         │
│                          │
│   Methods:               │
│   - chat(message)        │
│   - executeTask(task)    │
│   - setModel(model)      │
│   - getHistory()         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   OpenRouter             │
│   (LLM Provider)         │
├─────────────────────────┤
│   Claude, GPT, Gemini,   │
│   Llama, Mistral, etc.   │
└─────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
cd packages/cloudflare-agent
bun install
```

### 2. Configure Secrets

```bash
# Set your OpenRouter API key
wrangler secret put OPENROUTER_API_KEY
```

### 3. Local Development

```bash
wrangler dev
```

### 4. Deploy

```bash
wrangler deploy
```

## API Reference

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/models` | List available models |
| WS | `/agents/CodingAgent/:sessionId` | Connect to agent instance |

### Callable Methods (via WebSocket RPC)

| Method | Args | Returns |
|--------|------|---------|
| `chat` | `(message: string)` | Assistant response text |
| `executeTask` | `(task: string)` | `{ result, model }` |
| `setModel` | `(model: string)` | `{ model }` |
| `setSystemPrompt` | `(prompt: string)` | `{ systemPrompt }` |
| `getHistory` | `()` | Message array |
| `clearHistory` | `()` | `{ cleared: true }` |

### Client Connection

```typescript
import { useAgent } from "agents/react"

function CodingChat() {
  const agent = useAgent({
    agent: "CodingAgent",
    name: "session-" + userId,
  })

  const sendMessage = async (text: string) => {
    const response = await agent.call("chat", text)
    console.log(response)
  }
}
```

## Configuration

### wrangler.jsonc

The agent uses:
- **Durable Objects** for persistent state per session
- **Workers AI** binding for optional local inference
- **SQLite storage** (via `new_sqlite_classes`) for structured data

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for LLM access |

## Scaling

Each user/session gets its own Durable Object instance:
- State persists across reconnections
- Automatic hibernation after 10min idle
- Horizontal scaling — no shared state between sessions
- Global edge deployment — low latency worldwide
