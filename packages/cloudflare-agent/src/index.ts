import { Agent, routeAgentRequest, callable } from "agents"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText, streamText } from "ai"

export interface Env {
  AI: Ai
  CODING_AGENT: DurableObjectNamespace<CodingAgent>
  OPENROUTER_API_KEY: string
}

interface AgentState {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>
  model: string
  systemPrompt: string
  taskHistory: Array<{ task: string; result: string; timestamp: number }>
}

export class CodingAgent extends Agent<Env, AgentState> {
  initialState: AgentState = {
    messages: [],
    model: "anthropic/claude-sonnet-4-5",
    systemPrompt: `You are an expert coding agent powered by OpenCode on Cloudflare's edge.
You help users write, debug, and understand code. You have access to tools for
file operations, shell commands, and web search.`,
    taskHistory: [],
  }

  @callable()
  async chat(userMessage: string): Promise<string> {
    const openrouter = createOpenRouter({
      apiKey: this.env.OPENROUTER_API_KEY,
    })

    const messages = [
      { role: "system" as const, content: this.state.systemPrompt },
      ...this.state.messages,
      { role: "user" as const, content: userMessage },
    ]

    const result = await generateText({
      model: openrouter(this.state.model),
      messages,
    })

    this.setState({
      ...this.state,
      messages: [
        ...this.state.messages,
        { role: "user", content: userMessage },
        { role: "assistant", content: result.text },
      ],
    })

    return result.text
  }

  @callable()
  async setModel(model: string) {
    this.setState({ ...this.state, model })
    return { model }
  }

  @callable()
  async setSystemPrompt(prompt: string) {
    this.setState({ ...this.state, systemPrompt: prompt })
    return { systemPrompt: prompt }
  }

  @callable()
  async getHistory() {
    return this.state.messages
  }

  @callable()
  async clearHistory() {
    this.setState({ ...this.state, messages: [] })
    return { cleared: true }
  }

  @callable()
  async executeTask(task: string): Promise<{ result: string; model: string }> {
    const openrouter = createOpenRouter({
      apiKey: this.env.OPENROUTER_API_KEY,
    })

    const result = await generateText({
      model: openrouter(this.state.model),
      messages: [
        { role: "system", content: this.state.systemPrompt },
        { role: "user", content: `Execute this task:\n\n${task}` },
      ],
    })

    this.setState({
      ...this.state,
      taskHistory: [
        ...this.state.taskHistory,
        { task, result: result.text, timestamp: Date.now() },
      ],
    })

    return { result: result.text, model: this.state.model }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/health") {
      return Response.json({ healthy: true, service: "opencode-cloudflare-agent" })
    }

    if (url.pathname === "/models") {
      return Response.json({
        available: [
          "anthropic/claude-sonnet-4-5",
          "anthropic/claude-haiku-4-5",
          "openai/gpt-4o",
          "openai/o3-mini",
          "google/gemini-2.5-pro",
          "meta-llama/llama-4-maverick",
        ],
      })
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    )
  },
}
