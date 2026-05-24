# OpenRouter Agent Example

Demonstrates using OpenRouter as a provider with OpenCode's agent system.

## Setup

```bash
# Set your OpenRouter API key
export OPENROUTER_API_KEY="sk-or-..."

# Run OpenCode with OpenRouter
bun dev
```

## Configuration

Add to your `opencode.json`:

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

## Available Models via OpenRouter

| Model | ID | Best For |
|-------|----|----|
| Claude Sonnet 4.5 | `anthropic/claude-sonnet-4-5` | Complex coding tasks |
| Claude Haiku 4.5 | `anthropic/claude-haiku-4-5` | Fast responses, triage |
| GPT-4o | `openai/gpt-4o` | General purpose |
| o3-mini | `openai/o3-mini` | Reasoning tasks |
| Gemini 2.5 Pro | `google/gemini-2.5-pro` | Long context |
| Llama 4 Maverick | `meta-llama/llama-4-maverick` | Open-source option |

## Agent Spawning

OpenRouter supports spawning multiple agents with different models:

```typescript
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })

// Spawn a planning agent
const planResult = await generateText({
  model: openrouter("anthropic/claude-sonnet-4-5"),
  system: "You are a planning agent. Break down tasks into steps.",
  prompt: userTask,
})

// Spawn an execution agent with a faster model
const execResult = await generateText({
  model: openrouter("anthropic/claude-haiku-4-5"),
  system: "You are an execution agent. Implement the given plan step by step.",
  prompt: planResult.text,
})
```

## Multi-Agent Orchestration

```typescript
// Parallel agent execution for independent subtasks
const results = await Promise.all([
  generateText({ model: openrouter("openai/gpt-4o"), prompt: subtask1 }),
  generateText({ model: openrouter("openai/gpt-4o"), prompt: subtask2 }),
  generateText({ model: openrouter("openai/gpt-4o"), prompt: subtask3 }),
])
```
