import { onMount, onCleanup, createSignal, type JSX } from "solid-js"
import { Rive, Layout, Fit, Alignment, type StateMachineInput } from "@rive-app/canvas"

export interface RiveCanvasProps {
  src: string
  artboard?: string
  stateMachines?: string | string[]
  animations?: string | string[]
  autoplay?: boolean
  fit?: "cover" | "contain" | "fill" | "none" | "scaleDown"
  alignment?: "center" | "topLeft" | "topCenter" | "topRight" | "centerLeft" | "centerRight" | "bottomLeft" | "bottomCenter" | "bottomRight"
  class?: string
  style?: JSX.CSSProperties
  onLoad?: (rive: Rive) => void
  onPlay?: () => void
  onPause?: () => void
  onStateChange?: (event: { data: string[] }) => void
}

const FIT_MAP: Record<string, Fit> = {
  cover: Fit.Cover,
  contain: Fit.Contain,
  fill: Fit.Fill,
  none: Fit.None,
  scaleDown: Fit.ScaleDown,
}

const ALIGNMENT_MAP: Record<string, Alignment> = {
  center: Alignment.Center,
  topLeft: Alignment.TopLeft,
  topCenter: Alignment.TopCenter,
  topRight: Alignment.TopRight,
  centerLeft: Alignment.CenterLeft,
  centerRight: Alignment.CenterRight,
  bottomLeft: Alignment.BottomLeft,
  bottomCenter: Alignment.BottomCenter,
  bottomRight: Alignment.BottomRight,
}

export function RiveCanvas(props: RiveCanvasProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let riveInstance: Rive | undefined
  const [loaded, setLoaded] = createSignal(false)

  onMount(() => {
    if (!canvasRef) return

    const stateMachines = props.stateMachines
      ? Array.isArray(props.stateMachines)
        ? props.stateMachines
        : [props.stateMachines]
      : undefined

    const animations = props.animations
      ? Array.isArray(props.animations)
        ? props.animations
        : [props.animations]
      : undefined

    riveInstance = new Rive({
      src: props.src,
      canvas: canvasRef,
      artboard: props.artboard,
      stateMachines,
      animations,
      autoplay: props.autoplay ?? true,
      layout: new Layout({
        fit: FIT_MAP[props.fit ?? "contain"] ?? Fit.Contain,
        alignment: ALIGNMENT_MAP[props.alignment ?? "center"] ?? Alignment.Center,
      }),
      onLoad: () => {
        setLoaded(true)
        riveInstance?.resizeDrawingSurfaceToCanvas()
        props.onLoad?.(riveInstance!)
      },
      onPlay: () => props.onPlay?.(),
      onPause: () => props.onPause?.(),
      onStateChange: (event) => props.onStateChange?.(event as { data: string[] }),
    })

    const observer = new ResizeObserver(() => {
      riveInstance?.resizeDrawingSurfaceToCanvas()
    })
    observer.observe(canvasRef)

    onCleanup(() => {
      observer.disconnect()
      riveInstance?.cleanup()
    })
  })

  return (
    <canvas
      ref={canvasRef}
      class={props.class}
      style={{
        width: "100%",
        height: "100%",
        ...props.style,
      }}
    />
  )
}

export function useRiveInputs(rive: Rive | undefined, stateMachineName: string) {
  if (!rive) return {}
  const inputs = rive.stateMachineInputs(stateMachineName)
  if (!inputs) return {}

  const inputMap: Record<string, StateMachineInput> = {}
  for (const input of inputs) {
    inputMap[input.name] = input
  }
  return inputMap
}
