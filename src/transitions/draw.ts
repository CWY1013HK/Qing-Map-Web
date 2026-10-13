/**
 * Stroke-draw reveal for an existing overlay feature (dashoffset animation).
 */
export function drawOverlayFeature(
  featureId: string,
  durationMs = 4000,
  signal?: AbortSignal,
): Promise<void> {
  const root = document.querySelector('.map-overlay-svg')
  if (!root) return Promise.resolve()

  const group = root.querySelector<SVGGElement>(
    `[data-overlay-id="${CSS.escape(featureId)}"]`,
  )
  if (!group) return Promise.resolve()

  const paths = [
    ...group.querySelectorAll<SVGPathElement>('path.overlay-stroke'),
  ]
  if (paths.length === 0) return Promise.resolve()

  const lengths: number[] = []
  for (const p of paths) {
    let len = 0
    try {
      len = p.getTotalLength()
    } catch {
      len = 800
    }
    lengths.push(len)
    p.style.transition = 'none'
    p.style.strokeDasharray = `${len}`
    p.style.strokeDashoffset = `${len}`
  }

  // Force layout before transitioning
  void group.getBoundingClientRect()

  for (const p of paths) {
    p.style.transition = `stroke-dashoffset ${durationMs}ms ease-in-out`
    p.style.strokeDashoffset = '0'
  }

  return new Promise((resolve) => {
    const done = () => {
      for (const p of paths) {
        p.style.transition = ''
        p.style.strokeDasharray = ''
        p.style.strokeDashoffset = ''
      }
      resolve()
    }
    if (signal?.aborted) {
      done()
      return
    }
    const t = window.setTimeout(done, durationMs + 40)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t)
        done()
      },
      { once: true },
    )
  })
}
