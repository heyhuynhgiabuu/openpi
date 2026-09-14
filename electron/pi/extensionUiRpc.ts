import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import type { PreapplyReview } from '../../src/lib/extensionUiTypes'
import { PREAPPLY_REVIEW_MARKER, preapplyReviewSchema } from '../../src/lib/extensionUiTypes'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../../src/lib/extensionUiTypes'
import type { ExtensionUiBridgeSinks } from './extensionUiBridge'
import { emitExtensionNotify, extensionNotifyLevelFromPi } from './extensionUiBridge'
import { fulfillExtensionUiPending, registerExtensionUiPending } from './extensionUiPending'

const DEFAULT_DIALOG_TIMEOUT_MS = 120_000

/**
 * Mirror Pi 0.85's ui_prompt_start / ui_prompt_end extension events for the
 * OpenPi renderer. The host cannot subscribe to ExtensionRunner.on (not a
 * public API), but OpenPi owns this ctx.ui bridge — every blocking prompt
 * flows through dialogPromise, so emitting the equivalent session events here
 * gives the renderer the same "agent blocked on user input" signal the SDK
 * emits in RPC mode.
 */
function emitUiPromptEvent(
  sinks: ExtensionUiBridgeSinks,
  type: 'ui_prompt_start' | 'ui_prompt_end',
  kind: ExtensionUiRequest['method'],
  title: string
): void {
  sinks.sessionEvent({ type, reason: 'ui_prompt', kind, title })
}

/**
 * The pre-apply review gate cannot send structured data through ctx.ui, so it
 * puts a marked JSON payload in the input placeholder. Recognising it here keeps
 * the payload out of the renderer's text box and turns it into a typed request.
 */
function parsePreapplyReview(placeholder: string): PreapplyReview | undefined {
  try {
    const raw: unknown = JSON.parse(placeholder.slice(PREAPPLY_REVIEW_MARKER.length))
    const parsed = preapplyReviewSchema.safeParse(raw)
    if (parsed.success) return parsed.data
    console.warn('[openpi] preapply review payload rejected', parsed.error.flatten())
  } catch (error) {
    console.warn('[openpi] preapply review payload unparseable', error)
  }
  return undefined
}

function dialogPromise<T>(
  sinks: ExtensionUiBridgeSinks,
  buildRequest: (id: string) => ExtensionUiRequest,
  parse: (response: ExtensionUiResponse) => T,
  defaultValue: T,
  opts?: { signal?: AbortSignal; timeout?: number }
): Promise<T> {
  if (opts?.signal?.aborted) return Promise.resolve(defaultValue)

  const id = crypto.randomUUID()
  const timeoutMs = opts?.timeout ?? DEFAULT_DIALOG_TIMEOUT_MS
  const request = buildRequest(id)
  const kind = request.method
  const title = request.title

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      opts?.signal?.removeEventListener('abort', onAbort)
      fulfillExtensionUiPending({ id, cancelled: true })
      resolve(defaultValue)
    }
    opts?.signal?.addEventListener('abort', onAbort, { once: true })

    registerExtensionUiPending(
      id,
      timeoutMs,
      (response) => {
        opts?.signal?.removeEventListener('abort', onAbort)
        resolve(parse(response))
      },
      (err) => {
        opts?.signal?.removeEventListener('abort', onAbort)
        reject(err)
      }
    )

    sinks.postExtensionUiRequest(request)
    emitUiPromptEvent(sinks, 'ui_prompt_start', kind, title)
  }).finally(() => {
    // .finally fires exactly once however the prompt settles: answer, cancel,
    // timeout, abort, or sidecar teardown.
    emitUiPromptEvent(sinks, 'ui_prompt_end', kind, title)
  })
}

/** Pi RPC-mode parity for ctx.ui dialog methods (confirm/select/input/editor). */
export function createOpenPiExtensionUIContext(sinks: ExtensionUiBridgeSinks): ExtensionUIContext {
  return {
    select: (title, options, opts) =>
      dialogPromise(
        sinks,
        (id) => ({ id, method: 'select', title, options, timeout: opts?.timeout }),
        (r) => (r.cancelled ? undefined : r.value),
        undefined,
        opts
      ),
    confirm: (title, message, opts) =>
      dialogPromise(
        sinks,
        (id) => ({ id, method: 'confirm', title, message, timeout: opts?.timeout }),
        (r) => (r.cancelled ? false : (r.confirmed ?? false)),
        false,
        opts
      ),
    input: (title, placeholder, opts) => {
      if (placeholder?.startsWith(PREAPPLY_REVIEW_MARKER)) {
        const review = parsePreapplyReview(placeholder)
        // A marked payload that does not validate means the gate and this host
        // disagree on the protocol. Answering "cancelled" denies the change
        // instead of showing the user raw JSON in a text box.
        if (!review) return Promise.resolve(undefined)
        return dialogPromise(
          sinks,
          (id) => ({ id, method: 'preapply_review', title, review, timeout: opts?.timeout }),
          // The gate parses this JSON; no answer (cancel, timeout, malformed)
          // reads as a denial there.
          (r) =>
            r.cancelled || !r.approved ? undefined : JSON.stringify({ approved: r.approved }),
          undefined,
          opts
        )
      }
      return dialogPromise(
        sinks,
        (id) => ({ id, method: 'input', title, placeholder, timeout: opts?.timeout }),
        (r) => (r.cancelled ? undefined : r.value),
        undefined,
        opts
      )
    },
    editor: (title, prefill) =>
      dialogPromise(
        sinks,
        (id) => ({ id, method: 'editor', title, prefill }),
        (r) => (r.cancelled ? undefined : r.value),
        undefined
      ),
    notify(message, type) {
      emitExtensionNotify(sinks, extensionNotifyLevelFromPi(type), message)
    },
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: (async () => undefined) as ExtensionUIContext['custom'],
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return {} as ExtensionUIContext['theme']
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Theme switching not supported in OpenPi' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  }
}
