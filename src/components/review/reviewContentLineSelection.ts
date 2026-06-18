import type { FileDiff, SelectedLineRange } from '@pierre/diffs'

type ReviewDiffSide = 'additions' | 'deletions'

interface SelectionPoint {
  lineNumber: number
  lineIndex: number
  side: ReviewDiffSide
}

interface ContentSelectionHandlers {
  onLineSelected?: (range: SelectedLineRange | null) => void
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void
}

interface BridgeState {
  pre: HTMLPreElement
  refs: {
    handlers: ContentSelectionHandlers
    instance: FileDiff<undefined>
  }
  cleanup: () => void
}

interface PointerSession {
  pointerId: number
  anchor: SelectionPoint
  current: SelectionPoint
}

interface InternalInteractionManager {
  selectedRange: SelectedLineRange | null
  renderSelection?: () => void
}

interface InternalFileDiff {
  interactionManager?: InternalInteractionManager
}

const bridges = new WeakMap<HTMLElement, BridgeState>()

function isPrimaryButton(event: PointerEvent): boolean {
  return event.pointerType !== 'mouse' || event.button === 0
}

function isFormControl(element: HTMLElement): boolean {
  return ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'A'].includes(element.tagName)
}

function isIgnoredPath(path: EventTarget[]): boolean {
  return path.some((target) => target instanceof HTMLElement && isFormControl(target))
}

function findDiffPre(host: HTMLElement): HTMLPreElement | null {
  const root = host.shadowRoot ?? host
  return root.querySelector<HTMLPreElement>('pre')
}

function parseLineIndex(element: HTMLElement, split: boolean): number | null {
  const values = (element.getAttribute('data-line-index') ?? '')
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
  const index = split && values.length > 1 ? values[1] : values[0]
  return index ?? null
}

function sideForLine(lineElement: HTMLElement, codeElement: HTMLElement | null): ReviewDiffSide {
  switch (lineElement.getAttribute('data-line-type')) {
    case 'change-deletion':
      return 'deletions'
    case 'change-addition':
      return 'additions'
    default:
      return codeElement?.hasAttribute('data-deletions') ? 'deletions' : 'additions'
  }
}

function pointFromElement(element: Element | null, pre: HTMLPreElement): SelectionPoint | null {
  const lineElement = element?.closest<HTMLElement>('[data-line]')
  if (!lineElement || !pre.contains(lineElement)) return null
  const lineNumber = Number.parseInt(lineElement.getAttribute('data-line') ?? '', 10)
  const lineIndex = parseLineIndex(lineElement, pre.getAttribute('data-diff-type') === 'split')
  if (!Number.isFinite(lineNumber) || lineIndex == null) return null
  return {
    lineNumber,
    lineIndex,
    side: sideForLine(lineElement, lineElement.closest<HTMLElement>('[data-code]')),
  }
}

export function getReviewContentSelectionPoint(
  path: EventTarget[],
  pre: HTMLPreElement
): SelectionPoint | null {
  if (
    path.some(
      (target) => target instanceof HTMLElement && target.hasAttribute('data-column-number')
    )
  ) {
    return null
  }
  for (const target of path) {
    if (!(target instanceof Element)) continue
    const point = pointFromElement(target, pre)
    if (point) return point
  }
  return null
}

function pointFromEvent(event: PointerEvent, pre: HTMLPreElement): SelectionPoint | null {
  const fromPath = getReviewContentSelectionPoint(event.composedPath(), pre)
  if (fromPath) return fromPath
  const root = pre.getRootNode()
  const element =
    root instanceof ShadowRoot
      ? root.elementFromPoint(event.clientX, event.clientY)
      : document.elementFromPoint(event.clientX, event.clientY)
  return pointFromElement(element, pre)
}

function buildRange(anchor: SelectionPoint, current: SelectionPoint): SelectedLineRange {
  return {
    start: anchor.lineNumber,
    end: current.lineNumber,
    side: anchor.side,
    ...(anchor.side !== current.side ? { endSide: current.side } : {}),
  }
}

function renderSelectionPreview(instance: FileDiff<undefined>, range: SelectedLineRange): void {
  const manager = (instance as unknown as InternalFileDiff).interactionManager
  if (!manager?.renderSelection) {
    instance.setSelectedLines(range)
    return
  }
  manager.selectedRange = range
  manager.renderSelection()
}

function createBridge(
  pre: HTMLPreElement,
  instance: FileDiff<undefined>,
  handlers: ContentSelectionHandlers
): BridgeState {
  const refs = { handlers, instance }
  let session: PointerSession | null = null

  const finish = () => {
    session = null
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerCancel)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!isPrimaryButton(event) || isIgnoredPath(event.composedPath())) return
    const point = getReviewContentSelectionPoint(event.composedPath(), pre)
    if (!point) return
    event.preventDefault()
    session = { pointerId: event.pointerId, anchor: point, current: point }
    renderSelectionPreview(refs.instance, buildRange(point, point))
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return
    const point = pointFromEvent(event, pre)
    if (!point) return
    event.preventDefault()
    if (point.side !== session.anchor.side) return
    if (point.lineIndex === session.current.lineIndex) return
    session.current = point
    renderSelectionPreview(refs.instance, buildRange(session.anchor, point))
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return
    const next = pointFromEvent(event, pre)
    const point = next?.side === session.anchor.side ? next : session.current
    const range = buildRange(session.anchor, point)
    event.preventDefault()
    renderSelectionPreview(refs.instance, range)
    refs.handlers.onLineSelectionEnd?.(range)
    refs.handlers.onLineSelected?.(range)
    finish()
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (!session || event.pointerId !== session.pointerId) return
    refs.handlers.onLineSelectionEnd?.(null)
    finish()
  }

  pre.addEventListener('pointerdown', onPointerDown)

  return {
    pre,
    refs,
    cleanup: () => {
      pre.removeEventListener('pointerdown', onPointerDown)
      finish()
    },
  }
}

export function installReviewContentLineSelection(
  host: HTMLElement,
  instance: FileDiff<undefined>,
  handlers: ContentSelectionHandlers
): void {
  const pre = findDiffPre(host)
  if (!pre) return
  const existing = bridges.get(host)
  if (existing?.pre === pre) {
    existing.refs.instance = instance
    existing.refs.handlers = handlers
    return
  }
  existing?.cleanup()
  bridges.set(host, createBridge(pre, instance, handlers))
}
