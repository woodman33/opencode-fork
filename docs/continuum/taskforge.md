# TaskForge Architecture

## Overview

TaskForge is the durable task queue and workflow engine for the Continuum platform. Built on Cloudflare Durable Objects, it provides persistent, exactly-once task execution with automatic retries and scheduling.

## Design Principles

1. **Durable by default** — Tasks survive Worker restarts and network failures
2. **Edge-native** — Runs on Cloudflare's global network, low latency everywhere
3. **Agent-first** — Designed for AI agent orchestration patterns
4. **Observable** — Every task has a full execution trace

## Architecture

```
┌─────────────────────────────────────────┐
│            TaskForge                      │
├─────────────────────────────────────────┤
│                                           │
│  ┌─────────────┐    ┌────────────────┐  │
│  │ Task Queue  │───▶│ Task Executor  │  │
│  │ (Durable    │    │ (Worker)       │  │
│  │  Object)    │    └───────┬────────┘  │
│  └─────────────┘            │            │
│                              ▼            │
│  ┌──────────────────────────────────┐    │
│  │         Task Types                │    │
│  │  ┌──────┐ ┌───────┐ ┌────────┐  │    │
│  │  │ Code │ │ Agent │ │ Deploy │  │    │
│  │  │ Gen  │ │ Chain │ │  Flow  │  │    │
│  │  └──────┘ └───────┘ └────────┘  │    │
│  └──────────────────────────────────┘    │
│                                           │
│  ┌──────────────────────────────────┐    │
│  │         Scheduling                │    │
│  │  • One-time delays                │    │
│  │  • Cron expressions               │    │
│  │  • Event-driven triggers          │    │
│  └──────────────────────────────────┘    │
│                                           │
└─────────────────────────────────────────┘
```

## Task Definition

```typescript
import { DurableObject } from "cloudflare:workers"

interface Task {
  id: string
  type: "code-gen" | "agent-chain" | "deploy" | "review"
  payload: Record<string, unknown>
  status: "pending" | "running" | "completed" | "failed" | "retrying"
  attempts: number
  maxAttempts: number
  createdAt: number
  completedAt?: number
  result?: unknown
  error?: string
}

export class TaskQueue extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          result TEXT,
          error TEXT
        )
      `)
    })
  }

  async enqueue(task: Omit<Task, "id" | "status" | "attempts" | "createdAt">): Promise<string> {
    const id = crypto.randomUUID()
    this.ctx.storage.sql.exec(
      `INSERT INTO tasks (id, type, payload, max_attempts, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id, task.type, JSON.stringify(task.payload), task.maxAttempts ?? 3, Date.now()
    )
    await this.ctx.storage.setAlarm(Date.now() + 100)
    return id
  }

  async alarm() {
    const pending = this.ctx.storage.sql.exec<Task>(
      `SELECT * FROM tasks WHERE status IN ('pending', 'retrying') LIMIT 10`
    ).toArray()

    for (const task of pending) {
      await this.executeTask(task)
    }

    const hasMore = this.ctx.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM tasks WHERE status IN ('pending', 'retrying')`
    ).one()

    if (hasMore.count > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 1000)
    }
  }

  private async executeTask(task: Task) {
    this.ctx.storage.sql.exec(
      `UPDATE tasks SET status = 'running', attempts = attempts + 1 WHERE id = ?`,
      task.id
    )
    // Task execution logic here
  }
}
```

## Integration with OpenCode

TaskForge tasks can be triggered from OpenCode sessions:

```typescript
// From an OpenCode tool or command
async function submitCodeGenTask(prompt: string, sessionId: string) {
  const taskQueue = env.TASK_QUEUE.getByName("global")
  const taskId = await taskQueue.enqueue({
    type: "code-gen",
    payload: { prompt, sessionId, model: "anthropic/claude-sonnet-4-5" },
    maxAttempts: 3,
  })
  return taskId
}
```

## Scheduling Patterns

```typescript
// Delayed execution
await taskQueue.enqueue({ type: "deploy", payload: { ... }, delay: 300_000 })

// Recurring (via alarm rescheduling)
async alarm() {
  await this.runRecurringTasks()
  await this.ctx.storage.setAlarm(Date.now() + 60_000) // Every minute
}
```

## Status Tracking

```typescript
async getStatus(taskId: string): Promise<Task | null> {
  const result = this.ctx.storage.sql.exec<Task>(
    `SELECT * FROM tasks WHERE id = ?`, taskId
  ).toArray()
  return result[0] ?? null
}

async getStats(): Promise<{ pending: number; running: number; completed: number; failed: number }> {
  return this.ctx.storage.sql.exec<Record<string, number>>(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM tasks
  `).one()
}
```
