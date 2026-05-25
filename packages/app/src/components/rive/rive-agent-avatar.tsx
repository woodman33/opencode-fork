import { createSignal, onMount, onCleanup } from "solid-js"

export interface RiveAgentAvatarProps {
  state?: "idle" | "thinking" | "speaking" | "listening"
  size?: number
  color?: string
  accentColor?: string
  class?: string
}

export function RiveAgentAvatar(props: RiveAgentAvatarProps) {
  const size = () => props.size ?? 64
  let canvasRef: HTMLCanvasElement | undefined
  let animFrame: number | undefined

  onMount(() => {
    if (!canvasRef) return
    const ctx = canvasRef.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvasRef.width = size() * dpr
    canvasRef.height = size() * dpr
    ctx.scale(dpr, dpr)

    let t = 0

    function draw() {
      if (!ctx || !canvasRef) return
      const s = size()
      const cx = s / 2
      const cy = s / 2
      const baseR = s * 0.3
      const state = props.state ?? "idle"
      const primary = props.color ?? "#6366f1"
      const accent = props.accentColor ?? "#818cf8"

      ctx.clearRect(0, 0, s, s)

      if (state === "thinking") {
        for (let ring = 0; ring < 3; ring++) {
          const ringR = baseR + ring * s * 0.06
          const alpha = 0.1 + 0.1 * Math.sin(t * 2 + ring)
          ctx.beginPath()
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
          ctx.strokeStyle = accent
          ctx.globalAlpha = alpha
          ctx.lineWidth = 1.5
          ctx.stroke()
        }

        const orbitCount = 3
        for (let i = 0; i < orbitCount; i++) {
          const a = t * 3 + (i * Math.PI * 2) / orbitCount
          const orbitR = baseR + s * 0.1
          const ox = cx + Math.cos(a) * orbitR
          const oy = cy + Math.sin(a) * orbitR
          ctx.beginPath()
          ctx.arc(ox, oy, s * 0.025, 0, Math.PI * 2)
          ctx.fillStyle = accent
          ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 4 + i)
          ctx.fill()
        }
      }

      if (state === "speaking") {
        const waveCount = 5
        for (let i = 0; i < waveCount; i++) {
          const waveR = baseR + s * 0.05 * (i + 1) * (0.5 + 0.5 * Math.sin(t * 6 + i * 0.5))
          ctx.beginPath()
          ctx.arc(cx, cy, waveR, 0, Math.PI * 2)
          ctx.strokeStyle = accent
          ctx.globalAlpha = 0.3 - i * 0.05
          ctx.lineWidth = 2 - i * 0.3
          ctx.stroke()
        }
      }

      if (state === "listening") {
        const barCount = 12
        for (let i = 0; i < barCount; i++) {
          const a = (i * Math.PI * 2) / barCount
          const amplitude = 0.5 + 0.5 * Math.sin(t * 5 + i * 0.7)
          const barLen = s * 0.04 + s * 0.06 * amplitude
          const inner = baseR + s * 0.02
          const x1 = cx + Math.cos(a) * inner
          const y1 = cy + Math.sin(a) * inner
          const x2 = cx + Math.cos(a) * (inner + barLen)
          const y2 = cy + Math.sin(a) * (inner + barLen)
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.strokeStyle = accent
          ctx.globalAlpha = 0.5 + 0.5 * amplitude
          ctx.lineWidth = 2
          ctx.lineCap = "round"
          ctx.stroke()
        }
      }

      ctx.globalAlpha = 1

      const breathe = state === "idle" ? 1 + 0.02 * Math.sin(t * 1.5) : 1
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * breathe)
      grad.addColorStop(0, primary)
      grad.addColorStop(1, accent)
      ctx.beginPath()
      ctx.arc(cx, cy, baseR * breathe, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      const eyeSpacing = s * 0.08
      const eyeY = cy - s * 0.03
      const eyeR = s * 0.035
      const blinkPhase = Math.sin(t * 0.5)
      const eyeScaleY = blinkPhase > 0.95 ? 0.1 : 1

      ctx.fillStyle = "white"
      for (const side of [-1, 1]) {
        ctx.save()
        ctx.translate(cx + side * eyeSpacing, eyeY)
        ctx.scale(1, eyeScaleY)
        ctx.beginPath()
        ctx.arc(0, 0, eyeR, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      t += 0.016
      animFrame = requestAnimationFrame(draw)
    }

    draw()

    onCleanup(() => {
      if (animFrame) cancelAnimationFrame(animFrame)
    })
  })

  return (
    <canvas
      ref={canvasRef}
      class={props.class}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
      }}
    />
  )
}
