import type { ExtensionUiRequest, ExtensionUiResponse } from '../../../src/lib/extensionUiTypes'

/**
 * The review prompt's transport: register a pending entry, send the request to the renderer, and
 * wait for the answer. Extracted from `durableHost.ts` so it can be tested — this wiring between the
 * gate and the renderer is the part a user is trusting, and it was untestable inside the sidecar
 * entry point.
 *
 * Three ways out, and all of them deny:
 * - the renderer answers;
 * - nobody answers within the timeout (`register` settles it as `cancelled`);
 * - the run is aborted (Stop, new session, reload, fork). That path releases the pending entry and
 *   rejects. Releasing alone would also end the wait — the gate turns a cancelled answer into a
 *   block — but rejecting ends the *task* as aborted rather than as a blocked tool call, which is
 *   what the user actually asked for.
 *
 * Without any abort path a pending review held the run open for the full ten minutes:
 * `harness.abort()` and `close()` both waited, and `sessionLifecycle` awaits the durable stop
 * before every session start, so Stop and "new session" looked frozen.
 */
export interface ReviewAskDeps {
  /** Hands one request to the sidecar's parent process. */
  send: (request: ExtensionUiRequest) => void
  /** Registers a pending entry; the answer arrives through `fulfill`. */
  register: (
    id: string,
    timeoutMs: number,
    resolve: (response: ExtensionUiResponse) => void,
    reject: (error: Error) => void
  ) => void
  /** Settles a pending entry early, used to release it when nothing else will. */
  fulfill: (response: ExtensionUiResponse) => boolean
  /** Surfaces a failure; only ever a way to say why, never the reason to block. */
  log: (level: 'info' | 'warn' | 'error', text: string) => void
  /** Tells the renderer a prompt opened or closed, so its dialog cannot outlive the wait. */
  emitPrompt?: (phase: 'start' | 'end', request: ExtensionUiRequest) => void
  defaultTimeoutMs: number
}

export type ReviewAsk = (
  request: ExtensionUiRequest,
  signal?: AbortSignal
) => Promise<ExtensionUiResponse>

export function createReviewAsk(deps: ReviewAskDeps): ReviewAsk {
  return (request, signal) =>
    new Promise<ExtensionUiResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('the run was aborted before the review could be shown'))
        return
      }

      let open = true
      // Settling happens before the end-of-prompt event, and the event is guarded: `emitPrompt` is
      // the same `send` the request went out on, so a port that throws must not be able to leave the
      // promise unsettled — that would hang the run with no way out.
      const close = (): boolean => {
        if (!open) return false
        open = false
        signal?.removeEventListener('abort', onAbort)
        try {
          deps.emitPrompt?.('end', request)
        } catch (error) {
          deps.log(
            'warn',
            `[durable] could not report the end of a review prompt: ${error instanceof Error ? error.message : String(error)}`
          )
        }
        return true
      }
      function onAbort(): void {
        // `close()` flips `open` first, so the `fulfill` below cannot resolve this promise: the
        // rejection below is the only settlement.
        if (!close()) return
        deps.fulfill({ id: request.id, cancelled: true })
        reject(new Error('the run was aborted while the review was open'))
      }

      // Registered before sending, so an answer that arrives synchronously still finds its entry.
      deps.register(
        request.id,
        request.timeout ?? deps.defaultTimeoutMs,
        (response) => {
          if (!close()) return
          resolve(response)
        },
        (error) => {
          if (!close()) return
          reject(error)
        }
      )
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        deps.emitPrompt?.('start', request)
        deps.send(request)
      } catch (error) {
        // A send that never left would otherwise hang the tool call until the timeout.
        deps.fulfill({ id: request.id, cancelled: true })
        deps.log(
          'error',
          `[durable] could not ask for review: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })
}
