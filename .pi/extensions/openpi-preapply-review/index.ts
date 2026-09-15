/**
 * OpenPi pre-apply review — optional gate that asks before Pi writes a file.
 *
 * Pi runs its own tools, so the only sanctioned place to stop a write is the
 * `tool_call` event: it fires before the tool executes, can block with
 * `{ block: true, reason }`, and Pi reports the reason back to the model as the
 * tool result. This extension uses that hook plus `ctx.ui`, which OpenPi renders
 * in its own dialogs (the same bridge as every other extension prompt).
 *
 * Inside OpenPi an `edit` opens a hunk review: the approved entries stay in
 * `event.input.edits` and the rest are dropped, so Pi's own tool performs the
 * write and its result diff tells the model what was skipped. `write` keeps a
 * text allow/deny, because a rewrite has no hunk to drop. Outside OpenPi (a TUI
 * session) both tools fall back to that text confirm.
 *
 * The review waits much longer than Pi's two-minute dialog default, because
 * reviewing a diff is not a yes/no glance; if it does expire, the gate says so
 * instead of letting the change disappear silently. The user can also skip the
 * rest of the turn from the modal, which clears at `turn_end`.
 *
 * Off by default: Pi is YOLO by default and a gate stops every edit until the
 * user answers. Enable it per session with OPENPI_PREAPPLY_REVIEW=1 in the
 * environment OpenPi (and therefore the sidecar) is started with.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  asRecord,
  confirmMessage,
  displayPath,
  editHunks,
  hunksSummary,
  previewForToolCall,
  str,
} from './preview'

/**
 * Must match PREAPPLY_REVIEW_MARKER in src/lib/extensionUiTypes.ts: the sidecar
 * turns a marked ctx.ui.input placeholder into the renderer's hunk review. An
 * extension cannot import app code, so this literal is duplicated on purpose.
 */
const REVIEW_MARKER = 'openpi-preapply-review:'

/**
 * Pi dismisses a dialog after two minutes by default. Reviewing a diff takes
 * longer than answering a yes/no prompt, so the gate waits ten.
 */
const REVIEW_TIMEOUT_MS = 600_000

/**
 * Set when the user asked to skip review for the rest of the turn, cleared at
 * `turn_end`. Turn-scoped on purpose: it stops a ten-file refactor from asking
 * ten times, without letting one answer cover the rest of the session.
 */
let skipReviewThisTurn = false

export function isPreApplyReviewEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.OPENPI_PREAPPLY_REVIEW === '1'
}

export function endTurn(): void {
  skipReviewThisTurn = false
}

/** The part of Pi's tool_call event and context this gate reads. */
export interface PreApplyToolCall {
  toolName: string
  input: unknown
}

export interface PreApplyContext {
  cwd: string
  signal?: AbortSignal
  ui: {
    confirm: (
      title: string,
      message: string,
      opts?: { signal?: AbortSignal; timeout?: number }
    ) => Promise<boolean>
    input: (
      title: string,
      placeholder?: string,
      opts?: { signal?: AbortSignal; timeout?: number }
    ) => Promise<string | undefined>
    notify: (message: string, type?: 'info' | 'warning' | 'error') => void
  }
}

export interface BlockedToolCall {
  block: true
  reason: string
}

/** True when Pi runs inside OpenPi, which renders the hunk review modal. */
export function isOpenPiHost(env: NodeJS.ProcessEnv): boolean {
  return env.OPENPI_BRIDGE_APP === 'openpi'
}

export interface ReviewAnswer {
  approved: number[]
  /** The user asked to skip review for the rest of this turn. */
  remember: boolean
}

/**
 * Reads the review answer, or null when the user cancelled, the dialog expired,
 * or the answer is something this gate cannot read (all of which count as a
 * denial).
 */
export function parseReviewAnswer(answer: string | undefined, count: number): ReviewAnswer | null {
  if (answer === undefined) return null
  let raw: unknown
  try {
    raw = JSON.parse(answer)
  } catch {
    return null
  }

  const record = asRecord(raw)
  const list = record.approved
  if (!Array.isArray(list)) return null

  const inRange = new Set<number>()
  for (const value of list) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count) {
      inRange.add(value)
    }
  }
  return { approved: [...inRange].sort((a, b) => a - b), remember: record.remember === true }
}

function deny(path: string, why: string): BlockedToolCall {
  return {
    block: true,
    reason: `The user ${why} in the OpenPi pre-apply review of ${path}. Do not retry it unchanged.`,
  }
}

/**
 * Hunk review for `edit`: the user picks which of `edits[]` survive. Approved
 * entries are written back into the event input, so Pi's own tool applies them —
 * snapshots, the tool result, and the Review tab all stay on the normal path, and
 * the result diff shows the model exactly which hunks were dropped.
 */
async function reviewEdit(
  event: PreApplyToolCall,
  ctx: PreApplyContext
): Promise<BlockedToolCall | undefined> {
  const input = asRecord(event.input)
  const path = str(input.path)
  const hunks = editHunks(input)
  if (!path || !hunks) return undefined

  const shownPath = displayPath(ctx.cwd, path)
  const review = { path: shownPath, summary: hunksSummary(hunks), hunks }
  const answer = await ctx.ui.input(
    `Review before applying: ${shownPath}`,
    REVIEW_MARKER + JSON.stringify(review),
    { signal: ctx.signal, timeout: REVIEW_TIMEOUT_MS }
  )

  const parsed = parseReviewAnswer(answer, hunks.length)
  if (!parsed) {
    // No answer covers cancel and expiry alike. Saying so matters: otherwise the
    // edit just never lands and the user has no idea the review timed out.
    ctx.ui.notify(
      `Pre-apply review of ${shownPath} was not answered; the edit was not applied.`,
      'warning'
    )
    return deny(shownPath, 'did not answer')
  }

  if (parsed.approved.length === 0) return deny(shownPath, 'denied these changes')
  // Skipping review means letting the rest of the turn through, so it only
  // follows an approval; denying everything clearly does not ask for that.
  if (parsed.remember) skipReviewThisTurn = true
  if (parsed.approved.length === hunks.length) return undefined

  const edits = Array.isArray(input.edits) ? input.edits : []
  input.edits = parsed.approved.map((index) => edits[index])
  return undefined
}

/**
 * Returns a block result when the user denies the change, and nothing when the
 * call should proceed. Pi reports the reason back to the model as the tool
 * result, so the model knows the change was refused rather than failed.
 */
export async function handleToolCall(
  event: PreApplyToolCall,
  ctx: PreApplyContext
): Promise<BlockedToolCall | undefined> {
  if (skipReviewThisTurn && (event.toolName === 'edit' || event.toolName === 'write')) {
    return undefined
  }

  if (event.toolName === 'edit' && isOpenPiHost(process.env)) {
    return reviewEdit(event, ctx)
  }

  const preview = previewForToolCall(event.toolName, event.input, ctx.cwd)
  if (!preview) return undefined

  const allowed = await ctx.ui.confirm(
    `Review before applying: ${preview.path}`,
    `${preview.summary}\n\n${confirmMessage(preview)}`,
    // A boolean answer cannot tell a denial from an expiry, so the gate waits as
    // long as the hunk review and words the refusal for both cases.
    { signal: ctx.signal, timeout: REVIEW_TIMEOUT_MS }
  )
  if (allowed) return undefined

  return deny(preview.path, 'did not approve this change')
}

export default function (pi: ExtensionAPI) {
  if (!isPreApplyReviewEnabled(process.env)) return
  pi.on('tool_call', (event, ctx) => handleToolCall(event, ctx))
  pi.on('turn_end', () => endTurn())
  // A replacement session must not inherit "skip review" from the previous one.
  pi.on('session_start', () => endTurn())
}
