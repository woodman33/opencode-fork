# OpenRouter Configuration

## Overview

OpenRouter provides unified access to 200+ AI models through a single API. In the Continuum platform, it serves as the primary provider layer for both OpenCode (local agent) and the Cloudflare edge agent.

## Setup

### Environment Variable

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### OpenCode Configuration

Add to `opencode.json` in your project root:

```json
{
  "provider": {
    "openrouter": {
      "options": {
        "apiKey": "env:OPENROUTER_API_KEY"
      }
    }
  }
}
```

## Model Selection Strategy

### For Coding Tasks

| Task Type | Recommended Model | Why |
|-----------|-------------------|-----|
| Complex refactoring | `anthropic/claude-sonnet-4-5` | Best at multi-file changes |
| Quick edits | `anthropic/claude-haiku-4-5` | Fast, cost-effective |
| Code review | `openai/gpt-4o` | Strong analytical capabilities |
| Architecture planning | `anthropic/claude-sonnet-4-5` | Deep reasoning |
| Documentation | `anthropic/claude-haiku-4-5` | Good writing, fast |

### For Agent Orchestration

| Pattern | Model | Reasoning |
|---------|-------|-----------|
| Planner agent | `anthropic/claude-sonnet-4-5` | Needs deep reasoning |
| Executor agent | `anthropic/claude-haiku-4-5` | Speed over depth |
| Reviewer agent | `openai/gpt-4o` | Good at catching errors |
| Triage agent | `anthropic/claude-haiku-4-5` | Fast classification |

## Multi-Agent Spawning

### Sequential Pipeline

```typescript
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })

async function codeWithReview(task: string) {
  // Agent 1: Plan
  const plan = await generateText({
    model: openrouter("anthropic/claude-sonnet-4-5"),
    system: "Break this coding task into clear steps.",
    prompt: task,
  })

  // Agent 2: Implement
  const code = await generateText({
    model: openrouter("anthropic/claude-sonnet-4-5"),
    system: "Implement the given plan. Output only code.",
    prompt: plan.text,
  })

  // Agent 3: Review
  const review = await generateText({
    model: openrouter("openai/gpt-4o"),
    system: "Review this code for bugs, security issues, and improvements.",
    prompt: code.text,
  })

  return { plan: plan.text, code: code.text, review: review.text }
}
```

### Parallel Fan-Out

```typescript
async function analyzeCodebase(files: string[]) {
  const analyses = await Promise.all(
    files.map((file) =>
      generateText({
        model: openrouter("anthropic/claude-haiku-4-5"),
        system: "Analyze this file for complexity and suggest improvements.",
        prompt: file,
      })
    )
  )

  // Synthesize with a stronger model
  const synthesis = await generateText({
    model: openrouter("anthropic/claude-sonnet-4-5"),
    system: "Synthesize these individual file analyses into a codebase report.",
    prompt: analyses.map((a) => a.text).join("\n---\n"),
  })

  return synthesis.text
}
```

## Cost Optimization

### Token-Based Routing

```typescript
function selectModel(task: { complexity: "low" | "medium" | "high"; tokens: number }) {
  if (task.complexity === "low" || task.tokens < 500) {
    return "anthropic/claude-haiku-4-5" // $0.25/1M input
  }
  if (task.complexity === "medium") {
    return "openai/gpt-4o" // $2.50/1M input
  }
  return "anthropic/claude-sonnet-4-5" // $3/1M input
}
```

### Fallback Chain

```typescript
const models = [
  "anthropic/claude-sonnet-4-5",
  "openai/gpt-4o",
  "google/gemini-2.5-pro",
]

async function withFallback(prompt: string) {
  for (const model of models) {
    const result = await generateText({
      model: openrouter(model),
      prompt,
    }).catch(() => null)

    if (result) return { result, model }
  }
  throw new Error("All models failed")
}
```

## Rate Limits & Headers

OpenRouter respects the following headers (already configured in OpenCode):

```json
{
  "HTTP-Referer": "https://opencode.ai/",
  "X-Title": "opencode"
}
```

These help OpenRouter attribute usage and may provide priority during high demand.
