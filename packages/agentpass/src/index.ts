import { DurableObject } from "cloudflare:workers"
import { Hono } from "hono"

export interface Env {
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>
  USAGE_TRACKER: DurableObjectNamespace<UsageTracker>
  KEY_STORE: DurableObjectNamespace<KeyStore>
  ADMIN_SECRET: string
}

interface ApiKey {
  id: string
  name: string
  key: string
  permissions: string[]
  models: string[]
  rateLimit: { requests: number; window: string }
  teamId?: string
  createdAt: number
  expiresAt?: number
  revokedAt?: number
  lastUsedAt?: number
}

interface UsageRecord {
  keyId: string
  timestamp: number
  tokens: { input: number; output: number }
  model: string
  cost: number
}

function generateApiKey(environment: "live" | "test" = "live"): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `ocp_${environment}_${chars}`
}

// ─── KeyStore Durable Object ────────────────────────────────────────────────

export class KeyStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
          key TEXT PRIMARY KEY,
          data TEXT NOT NULL
        )
      `)
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS waitlist (
          email TEXT PRIMARY KEY,
          data TEXT NOT NULL
        )
      `)
    })
  }

  async getKey(key: string): Promise<ApiKey | null> {
    const rows = this.ctx.storage.sql.exec<{ data: string }>(
      `SELECT data FROM api_keys WHERE key = ?`, key,
    ).toArray()
    if (!rows[0]) return null
    return JSON.parse(rows[0].data)
  }

  async putKey(key: string, data: ApiKey) {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO api_keys (key, data) VALUES (?, ?)`,
      key, JSON.stringify(data),
    )
  }

  async deleteKey(key: string) {
    this.ctx.storage.sql.exec(`DELETE FROM api_keys WHERE key = ?`, key)
  }

  async listKeys(): Promise<ApiKey[]> {
    return this.ctx.storage.sql.exec<{ data: string }>(
      `SELECT data FROM api_keys ORDER BY rowid DESC LIMIT 100`,
    ).toArray().map((r) => JSON.parse(r.data))
  }

  async addToWaitlist(email: string, data: Record<string, unknown>) {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO waitlist (email, data) VALUES (?, ?)`,
      email, JSON.stringify(data),
    )
  }
}

// ─── Auth Helpers ───────────────────────────────────────────────────────────

async function authenticateRequest(
  authHeader: string | undefined,
  env: Env,
): Promise<{ key: ApiKey | null; error?: string }> {
  if (!authHeader?.startsWith("Bearer ocp_")) {
    return { key: null, error: "Missing or invalid Authorization header" }
  }

  const token = authHeader.slice(7)
  const store = env.KEY_STORE.get(env.KEY_STORE.idFromName("global"))
  const keyData = await store.getKey(token)

  if (!keyData) return { key: null, error: "Invalid API key" }
  if (keyData.revokedAt) return { key: null, error: "API key has been revoked" }
  if (keyData.expiresAt && Date.now() > keyData.expiresAt) {
    return { key: null, error: "API key has expired" }
  }

  return { key: keyData }
}

function isAdmin(authHeader: string | undefined, env: Env): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false
  const token = authHeader.slice(7)
  if (!env.ADMIN_SECRET) return false
  const encoder = new TextEncoder()
  const a = encoder.encode(token)
  const b = encoder.encode(env.ADMIN_SECRET)
  if (a.length !== b.length) return false
  return crypto.subtle.timingSafeEqual(a, b)
}

// ─── RateLimiter Durable Object ─────────────────────────────────────────────

export class RateLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL
        )
      `)
      this.ctx.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(timestamp)`,
      )
    })
  }

  async check(limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now()
    const windowStart = now - windowMs

    this.ctx.storage.sql.exec(`DELETE FROM requests WHERE timestamp < ?`, windowStart)

    const count = this.ctx.storage.sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM requests WHERE timestamp >= ?`, windowStart,
    ).one().count

    if (count >= limit) {
      const oldest = this.ctx.storage.sql.exec<{ timestamp: number }>(
        `SELECT MIN(timestamp) as timestamp FROM requests WHERE timestamp >= ?`, windowStart,
      ).one()
      return { allowed: false, remaining: 0, resetAt: oldest.timestamp + windowMs }
    }

    this.ctx.storage.sql.exec(`INSERT INTO requests (timestamp) VALUES (?)`, now)
    return { allowed: true, remaining: limit - count - 1, resetAt: now + windowMs }
  }
}

// ─── UsageTracker Durable Object ────────────────────────────────────────────

export class UsageTracker extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          tokens_input INTEGER DEFAULT 0,
          tokens_output INTEGER DEFAULT 0,
          model TEXT NOT NULL,
          cost REAL DEFAULT 0
        )
      `)
      this.ctx.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_usage_key ON usage(key_id, timestamp)`,
      )
    })
  }

  async record(record: UsageRecord) {
    this.ctx.storage.sql.exec(
      `INSERT INTO usage (key_id, timestamp, tokens_input, tokens_output, model, cost)
       VALUES (?, ?, ?, ?, ?, ?)`,
      record.keyId, record.timestamp,
      record.tokens.input, record.tokens.output,
      record.model, record.cost,
    )
  }

  async getSummary(keyId: string, sinceMs?: number): Promise<{
    totalRequests: number
    totalTokensInput: number
    totalTokensOutput: number
    totalCost: number
    models: Record<string, number>
  }> {
    const since = sinceMs ?? Date.now() - 30 * 24 * 60 * 60 * 1000
    const stats = this.ctx.storage.sql.exec<{
      total_requests: number
      total_input: number
      total_output: number
      total_cost: number
    }>(`
      SELECT COUNT(*) as total_requests,
        COALESCE(SUM(tokens_input), 0) as total_input,
        COALESCE(SUM(tokens_output), 0) as total_output,
        COALESCE(SUM(cost), 0) as total_cost
      FROM usage WHERE key_id = ? AND timestamp >= ?
    `, keyId, since).one()

    const modelRows = this.ctx.storage.sql.exec<{ model: string; count: number }>(`
      SELECT model, COUNT(*) as count FROM usage
      WHERE key_id = ? AND timestamp >= ? GROUP BY model ORDER BY count DESC
    `, keyId, since).toArray()

    const models: Record<string, number> = {}
    for (const row of modelRows) models[row.model] = row.count

    return {
      totalRequests: stats.total_requests,
      totalTokensInput: stats.total_input,
      totalTokensOutput: stats.total_output,
      totalCost: stats.total_cost,
      models,
    }
  }
}

// ─── HTTP API (Hono) ────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

app.get("/health", (c) => c.json({ healthy: true, service: "agentpass" }))

app.post("/keys", async (c) => {
  if (!isAdmin(c.req.header("Authorization"), c.env)) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const body = await c.req.json()
  const key = generateApiKey(body.environment ?? "live")
  const keyData: ApiKey = {
    id: crypto.randomUUID(),
    name: body.name ?? "Unnamed Key",
    key,
    permissions: body.permissions ?? ["chat"],
    models: body.models ?? ["*"],
    rateLimit: body.rateLimit ?? { requests: 1000, window: "1h" },
    teamId: body.teamId,
    createdAt: Date.now(),
    expiresAt: body.expiresIn ? Date.now() + body.expiresIn : undefined,
  }

  const store = c.env.KEY_STORE.get(c.env.KEY_STORE.idFromName("global"))
  await store.putKey(key, keyData)
  return c.json({ id: keyData.id, key, name: keyData.name, createdAt: keyData.createdAt }, 201)
})

app.get("/keys", async (c) => {
  if (!isAdmin(c.req.header("Authorization"), c.env)) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const store = c.env.KEY_STORE.get(c.env.KEY_STORE.idFromName("global"))
  const keys = await store.listKeys()
  return c.json(keys.map((k) => ({ id: k.id, name: k.name, createdAt: k.createdAt, revokedAt: k.revokedAt })))
})

app.delete("/keys/:key", async (c) => {
  if (!isAdmin(c.req.header("Authorization"), c.env)) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const store = c.env.KEY_STORE.get(c.env.KEY_STORE.idFromName("global"))
  const keyData = await store.getKey(c.req.param("key"))
  if (!keyData) return c.json({ error: "Key not found" }, 404)
  keyData.revokedAt = Date.now()
  await store.putKey(keyData.key, keyData)
  return c.json({ revoked: true, id: keyData.id })
})

app.post("/validate", async (c) => {
  const { key, error } = await authenticateRequest(c.req.header("Authorization"), c.env)
  if (!key) return c.json({ valid: false, error }, 401)

  const windowMs = parseWindow(key.rateLimit.window)
  const limiter = c.env.RATE_LIMITER.get(c.env.RATE_LIMITER.idFromName(key.id))
  const rateCheck = await limiter.check(key.rateLimit.requests, windowMs)

  if (!rateCheck.allowed) {
    return c.json({
      valid: false,
      error: "Rate limit exceeded",
      retryAfter: Math.ceil((rateCheck.resetAt - Date.now()) / 1000),
    }, 429)
  }

  const store = c.env.KEY_STORE.get(c.env.KEY_STORE.idFromName("global"))
  await store.putKey(key.key, { ...key, lastUsedAt: Date.now() })

  return c.json({
    valid: true,
    keyId: key.id,
    permissions: key.permissions,
    models: key.models,
    rateLimit: { remaining: rateCheck.remaining, resetAt: rateCheck.resetAt },
  })
})

app.post("/usage", async (c) => {
  const { key, error } = await authenticateRequest(c.req.header("Authorization"), c.env)
  if (!key) return c.json({ valid: false, error }, 401)
  const body = await c.req.json()
  const tracker = c.env.USAGE_TRACKER.get(c.env.USAGE_TRACKER.idFromName("global"))
  await tracker.record({
    keyId: key.id,
    timestamp: Date.now(),
    tokens: body.tokens ?? { input: 0, output: 0 },
    model: body.model ?? "unknown",
    cost: body.cost ?? 0,
  })
  return c.json({ recorded: true })
})

app.get("/usage/:keyId", async (c) => {
  if (!isAdmin(c.req.header("Authorization"), c.env)) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const tracker = c.env.USAGE_TRACKER.get(c.env.USAGE_TRACKER.idFromName("global"))
  const summary = await tracker.getSummary(c.req.param("keyId"))
  return c.json(summary)
})

app.post("/webhooks/tally", async (c) => {
  const payload = await c.req.json()
  if (payload.eventType === "FORM_RESPONSE") {
    const fields: Record<string, string> = {}
    for (const field of payload.data?.fields ?? []) {
      if (field.label && field.value) {
        fields[field.label.toLowerCase().replace(/\s+/g, "_")] = String(field.value)
      }
    }
    if (fields.email) {
      const store = c.env.KEY_STORE.get(c.env.KEY_STORE.idFromName("global"))
      await store.addToWaitlist(fields.email, {
        email: fields.email,
        name: fields.name ?? "",
        useCase: fields.use_case ?? "",
        submittedAt: Date.now(),
        formId: payload.data?.formId,
      })
    }
  }
  return c.json({ received: true })
})

function parseWindow(window: string): number {
  const match = window.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 3600000
  const value = parseInt(match[1], 10)
  const unit = match[2]
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
  return value * (multipliers[unit] ?? 3600000)
}

export default app
