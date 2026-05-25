# Continuum Project Documentation

> The Continuum platform — TaskForge, AgentPass, OpenRouter, Tally, Cloudflare, and more.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     CONTINUUM PLATFORM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  TaskForge   │  │  AgentPass   │  │   OpenCode (Fork)    │  │
│  │  Task Queue  │  │  Auth/Keys   │  │   AI Coding Agent    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                  │                      │               │
│  ┌──────┴──────────────────┴──────────────────────┴───────────┐  │
│  │              Cloudflare Workers (Edge Runtime)              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │  │
│  │  │   Durable   │  │    KV/R2     │  │   Workers AI    │  │  │
│  │  │   Objects   │  │   Storage    │  │   Inference     │  │  │
│  │  └─────────────┘  └──────────────┘  └─────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   Provider Layer                           │    │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │    │
│  │  │ OpenRouter │  │  Workers   │  │  Direct Providers  │ │    │
│  │  │  (Proxy)   │  │    AI      │  │  (Anthropic, etc)  │ │    │
│  │  └────────────┘  └────────────┘  └────────────────────┘ │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   Integrations                             │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────────┐  │    │
│  │  │  Tally  │  │ GitBook │  │  GitHub  │  │   Slack   │  │    │
│  │  │  Forms  │  │  Docs   │  │  Actions │  │   Bot     │  │    │
│  │  └─────────┘  └─────────┘  └─────────┘  └───────────┘  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Core Services

| Component | Description | Tech Stack |
|-----------|-------------|------------|
| **OpenCode Fork** | AI coding agent with TUI + Web UI | Bun, TypeScript, SolidJS |
| **TaskForge** | Durable task queue and workflow engine | Cloudflare Workers, Durable Objects |
| **AgentPass** | Auth, API key management, rate limiting | Cloudflare Workers, KV |

### Provider Layer

| Provider | Purpose | Models |
|----------|---------|--------|
| **OpenRouter** | Multi-provider proxy with fallback | All major LLMs |
| **Workers AI** | Edge inference, low latency | Llama, Mistral, embeddings |
| **Direct** | Direct API access when needed | Claude, GPT, Gemini |

### Integrations

| Integration | Purpose |
|-------------|---------|
| **Tally** | Form handling, user feedback, waitlists |
| **GitBook** | Documentation hosting and versioning |
| **GitHub** | Code hosting, Actions CI/CD, issue tracking |
| **Slack** | Team notifications, bot commands |

## Getting Started

See individual component docs:

- [Cloudflare Agent Setup](./cloudflare-agent.md)
- [OpenRouter Configuration](./openrouter.md)
- [TaskForge Architecture](./taskforge.md)
- [AgentPass Authentication](./agentpass.md)

## Development

```bash
# Clone and setup
git clone <repo-url>
cd opencode
bun install

# Run OpenCode (core agent)
bun dev

# Run Cloudflare agent (edge deployment)
cd packages/cloudflare-agent
wrangler dev

# Run documentation site
cd packages/web
bun dev
```
