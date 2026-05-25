import { DurableObject } from "cloudflare:workers"
import { Hono } from "hono"

export interface Env {
  TASK_QUEUE: DurableObjectNamespace<TaskQueue>
  WORKFLOW_ENGINE: DurableObjectNamespace<WorkflowEngine>
}

type TaskStatus = "pending" | "running" | "completed" | "failed" | "retrying" | "cancelled"
type TaskPriority = "critical" | "high" | "normal" | "low"

interface TaskRow {
  id: string
  type: string
  payload: string
  status: TaskStatus
  priority: string
  attempts: number
  max_attempts: number
  created_at: number
  started_at: number | null
  completed_at: number | null
  result: string | null
  error: string | null
  parent_id: string | null
  metadata: string | null
}

// ─── TaskQueue Durable Object ───────────────────────────────────────────────

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
          priority TEXT NOT NULL DEFAULT 'normal',
          attempts INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          result TEXT,
          error TEXT,
          parent_id TEXT,
          metadata TEXT
        )
      `)
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)
      `)
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority, created_at)
      `)
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)
      `)
    })
  }

  async enqueue(input: {
    type: string
    payload: Record<string, unknown>
    priority?: TaskPriority
    maxAttempts?: number
    parentId?: string
    metadata?: Record<string, unknown>
  }): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    this.ctx.storage.sql.exec(
      `INSERT INTO tasks (id, type, payload, priority, max_attempts, created_at, parent_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.type,
      JSON.stringify(input.payload),
      input.priority ?? "normal",
      input.maxAttempts ?? 3,
      Date.now(),
      input.parentId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )
    await this.ctx.storage.setAlarm(Date.now() + 50)
    return { id }
  }

  async getTask(taskId: string): Promise<TaskRow | null> {
    const rows = this.ctx.storage.sql.exec<TaskRow>(
      `SELECT * FROM tasks WHERE id = ?`,
      taskId,
    ).toArray()
    return rows[0] ?? null
  }

  async listTasks(options?: {
    status?: TaskStatus
    type?: string
    limit?: number
    offset?: number
  }): Promise<TaskRow[]> {
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    if (options?.status && options?.type) {
      return this.ctx.storage.sql.exec<TaskRow>(
        `SELECT * FROM tasks WHERE status = ? AND type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        options.status, options.type, limit, offset,
      ).toArray()
    }
    if (options?.status) {
      return this.ctx.storage.sql.exec<TaskRow>(
        `SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        options.status, limit, offset,
      ).toArray()
    }
    if (options?.type) {
      return this.ctx.storage.sql.exec<TaskRow>(
        `SELECT * FROM tasks WHERE type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        options.type, limit, offset,
      ).toArray()
    }
    return this.ctx.storage.sql.exec<TaskRow>(
      `SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      limit, offset,
    ).toArray()
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const task = await this.getTask(taskId)
    if (!task || task.status === "completed" || task.status === "cancelled") return false
    this.ctx.storage.sql.exec(
      `UPDATE tasks SET status = 'cancelled', completed_at = ? WHERE id = ?`,
      Date.now(), taskId,
    )
    return true
  }

  async retryTask(taskId: string): Promise<boolean> {
    const task = await this.getTask(taskId)
    if (!task || task.status !== "failed") return false
    this.ctx.storage.sql.exec(
      `UPDATE tasks SET status = 'pending', error = NULL, started_at = NULL WHERE id = ?`,
      taskId,
    )
    await this.ctx.storage.setAlarm(Date.now() + 50)
    return true
  }

  async getStats(): Promise<{
    total: number
    pending: number
    running: number
    completed: number
    failed: number
    cancelled: number
  }> {
    return this.ctx.storage.sql.exec<{
      total: number
      pending: number
      running: number
      completed: number
      failed: number
      cancelled: number
    }>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM tasks
    `).one()
  }

  async getChildren(parentId: string): Promise<TaskRow[]> {
    return this.ctx.storage.sql.exec<TaskRow>(
      `SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at ASC`,
      parentId,
    ).toArray()
  }

  async alarm() {
    const priorityOrder = "'critical','high','normal','low'"
    const pending = this.ctx.storage.sql.exec<TaskRow>(
      `SELECT * FROM tasks
       WHERE status IN ('pending', 'retrying')
       ORDER BY CASE priority
         WHEN 'critical' THEN 0
         WHEN 'high' THEN 1
         WHEN 'normal' THEN 2
         WHEN 'low' THEN 3
       END, created_at ASC
       LIMIT 10`,
    ).toArray()

    for (const task of pending) {
      this.ctx.storage.sql.exec(
        `UPDATE tasks SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ?`,
        Date.now(), task.id,
      )

      const success = await this.executeTask(task).catch(() => false)

      if (!success) {
        const updated = this.ctx.storage.sql.exec<TaskRow>(
          `SELECT * FROM tasks WHERE id = ?`, task.id,
        ).toArray()[0]

        if (updated && updated.attempts < updated.max_attempts) {
          const backoff = Math.min(1000 * Math.pow(2, updated.attempts), 30000)
          this.ctx.storage.sql.exec(
            `UPDATE tasks SET status = 'retrying', error = 'Retrying after failure' WHERE id = ?`,
            task.id,
          )
          await this.ctx.storage.setAlarm(Date.now() + backoff)
        } else {
          this.ctx.storage.sql.exec(
            `UPDATE tasks SET status = 'failed', completed_at = ? WHERE id = ?`,
            Date.now(), task.id,
          )
        }
      }
    }

    const hasMore = this.ctx.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM tasks WHERE status IN ('pending', 'retrying')`,
    ).one()

    if (hasMore.count > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 1000)
    }
  }

  private async executeTask(task: TaskRow): Promise<boolean> {
    const payload = JSON.parse(task.payload)

    switch (task.type) {
      case "code-gen":
      case "review":
      case "deploy":
      case "agent-chain": {
        this.ctx.storage.sql.exec(
          `UPDATE tasks SET status = 'completed', result = ?, completed_at = ? WHERE id = ?`,
          JSON.stringify({ executed: true, type: task.type, payload }),
          Date.now(),
          task.id,
        )
        return true
      }
      default: {
        this.ctx.storage.sql.exec(
          `UPDATE tasks SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
          `Unknown task type: ${task.type}`,
          Date.now(),
          task.id,
        )
        return false
      }
    }
  }
}

// ─── WorkflowEngine Durable Object ─────────────────────────────────────────

interface WorkflowRow {
  id: string
  name: string
  status: string
  steps: string
  current_step: number
  created_at: number
  completed_at: number | null
  result: string | null
  error: string | null
}

export class WorkflowEngine extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          steps TEXT NOT NULL,
          current_step INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          result TEXT,
          error TEXT
        )
      `)
    })
  }

  async createWorkflow(input: {
    name: string
    steps: Array<{ type: string; payload: Record<string, unknown> }>
  }): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    this.ctx.storage.sql.exec(
      `INSERT INTO workflows (id, name, steps, created_at) VALUES (?, ?, ?, ?)`,
      id, input.name, JSON.stringify(input.steps), Date.now(),
    )
    await this.ctx.storage.setAlarm(Date.now() + 100)
    return { id }
  }

  async getWorkflow(workflowId: string): Promise<WorkflowRow | null> {
    const rows = this.ctx.storage.sql.exec<WorkflowRow>(
      `SELECT * FROM workflows WHERE id = ?`, workflowId,
    ).toArray()
    return rows[0] ?? null
  }

  async alarm() {
    const active = this.ctx.storage.sql.exec<WorkflowRow>(
      `SELECT * FROM workflows WHERE status IN ('pending', 'running') LIMIT 5`,
    ).toArray()

    for (const workflow of active) {
      const steps = JSON.parse(workflow.steps) as Array<{ type: string; payload: Record<string, unknown> }>

      if (workflow.current_step >= steps.length) {
        this.ctx.storage.sql.exec(
          `UPDATE workflows SET status = 'completed', completed_at = ?, result = ? WHERE id = ?`,
          Date.now(), JSON.stringify({ stepsCompleted: steps.length }), workflow.id,
        )
        continue
      }

      this.ctx.storage.sql.exec(
        `UPDATE workflows SET status = 'running' WHERE id = ?`, workflow.id,
      )

      const taskQueue = this.env.TASK_QUEUE.get(
        this.env.TASK_QUEUE.idFromName("global"),
      )
      const step = steps[workflow.current_step]
      await taskQueue.enqueue({
        type: step.type,
        payload: { ...step.payload, workflowId: workflow.id, stepIndex: workflow.current_step },
        parentId: workflow.id,
      })

      this.ctx.storage.sql.exec(
        `UPDATE workflows SET current_step = current_step + 1 WHERE id = ?`,
        workflow.id,
      )
    }

    const hasMore = this.ctx.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM workflows WHERE status IN ('pending', 'running')`,
    ).one()
    if (hasMore.count > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 2000)
    }
  }
}

// ─── HTTP API (Hono) ────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

app.get("/health", (c) => c.json({ healthy: true, service: "taskforge" }))

app.post("/tasks", async (c) => {
  const body = await c.req.json()
  const queue = c.env.TASK_QUEUE.get(c.env.TASK_QUEUE.idFromName(body.queue ?? "global"))
  const result = await queue.enqueue(body)
  return c.json(result, 201)
})

app.get("/tasks", async (c) => {
  const queue = c.env.TASK_QUEUE.get(c.env.TASK_QUEUE.idFromName(c.req.query("queue") ?? "global"))
  const tasks = await queue.listTasks({
    status: c.req.query("status") as TaskStatus | undefined,
    type: c.req.query("type") ?? undefined,
    limit: Number(c.req.query("limit") ?? 50),
  })
  return c.json(tasks)
})

app.get("/tasks/:id", async (c) => {
  const queue = c.env.TASK_QUEUE.get(c.env.TASK_QUEUE.idFromName(c.req.query("queue") ?? "global"))
  const task = await queue.getTask(c.req.param("id"))
  if (!task) return c.json({ error: "Task not found" }, 404)
  return c.json(task)
})

app.post("/tasks/:id/cancel", async (c) => {
  const queue = c.env.TASK_QUEUE.get(c.env.TASK_QUEUE.idFromName(c.req.query("queue") ?? "global"))
  const cancelled = await queue.cancelTask(c.req.param("id"))
  return c.json({ cancelled })
})

app.post("/tasks/:id/retry", async (c) => {
  const queue = c.env.TASK_QUEUE.get(c.env.TASK_QUEUE.idFromName(c.req.query("queue") ?? "global"))
  const retried = await queue.retryTask(c.req.param("id"))
  return c.json({ retried })
})

app.get("/stats", async (c) => {
  const queue = c.env.TASK_QUEUE.get(c.env.TASK_QUEUE.idFromName(c.req.query("queue") ?? "global"))
  const stats = await queue.getStats()
  return c.json(stats)
})

app.post("/workflows", async (c) => {
  const body = await c.req.json()
  const engine = c.env.WORKFLOW_ENGINE.get(c.env.WORKFLOW_ENGINE.idFromName("global"))
  const result = await engine.createWorkflow(body)
  return c.json(result, 201)
})

app.get("/workflows/:id", async (c) => {
  const engine = c.env.WORKFLOW_ENGINE.get(c.env.WORKFLOW_ENGINE.idFromName("global"))
  const workflow = await engine.getWorkflow(c.req.param("id"))
  if (!workflow) return c.json({ error: "Workflow not found" }, 404)
  return c.json(workflow)
})

export default app
