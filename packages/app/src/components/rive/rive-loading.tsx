import { createSignal, onMount, onCleanup, Show } from "solid-js"

export interface RiveLoadingSpinnerProps {
  size?: number
  color?: string
  class?: string
}

export function RiveLoadingSpinner(props: RiveLoadingSpinnerProps) {
  const size = () => props.size ?? 48
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

    let angle = 0
    const color = props.color ?? "currentColor"

    function draw() {
      if (!ctx || !canvasRef) return
      const s = size()
      const cx = s / 2
      const cy = s / 2
      const r = s * 0.35

      ctx.clearRect(0, 0, s, s)

      const nodeCount = 8
      for (let i = 0; i < nodeCount; i++) {
        const a = angle + (i * Math.PI * 2) / nodeCount
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        const scale = 0.4 + 0.6 * ((Math.sin(angle * 2 + i * 0.8) + 1) / 2)
        const radius = s * 0.06 * scale

        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.3 + 0.7 * scale
        ctx.fill()
      }

      ctx.globalAlpha = 1
      const pulseR = r * 0.3 * (0.8 + 0.2 * Math.sin(angle * 3))
      ctx.beginPath()
      ctx.arc(cx, cy, pulseR, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.globalAlpha = 0.15
      ctx.fill()

      ctx.globalAlpha = 1
      angle += 0.03
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
