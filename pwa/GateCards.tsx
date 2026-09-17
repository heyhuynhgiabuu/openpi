/**
 * pwa/GateCards — pending approvals, the P0's only mutation surface.
 *
 * Cards arrive on the gate_update stream; decisions POST the card's one-time
 * token. 409/410 answers simply drop the card: someone else answered, or the
 * gate is gone.
 */
import { For, Show, createSignal } from 'solid-js'
import { api, ApiError, type RemoteGate } from './api'
import { preapplyReviewSchema } from '../src/lib/extensionUiTypes'

interface GateState {
  pending: RemoteGate[]
  notice: string
}

export function GateCards(props: { state: GateState; onUnauthenticated: () => void }) {
  const [busyId, setBusyId] = createSignal('')
  const [error, setError] = createSignal('')

  const decide = async (gate: RemoteGate, approve: boolean): Promise<void> => {
    const review = preapplyReviewSchema.safeParse(gate.payload)
    // A supplied payload must be reviewable before it can be approved.
    if (approve && gate.payload !== undefined && !review.success) return
    setBusyId(gate.id)
    setError('')
    try {
      // Hunk gates approve as a whole from the phone: all indexes or none.
      const approvedIndexes =
        approve && review.success ? review.data.hunks.map((_, index) => index) : undefined
      await api.decideGate(gate.id, approve, gate.gateToken, approvedIndexes)
    } catch (err) {
      // 409/410: answered elsewhere or expired — the next gate_update drops
      // the card. 401: pairing is dead; reset to the pair screen.
      if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
        setError('')
      } else if (err instanceof ApiError && err.status === 401) {
        props.onUnauthenticated()
        return
      } else {
        setError('Decision failed. Check your connection and try again.')
      }
    } finally {
      setBusyId('')
    }
  }

  return (
    <Show when={props.state.pending.length > 0 || props.state.notice || error()}>
      <h2>Pending approvals</h2>
      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
      <Show when={props.state.notice}>
        <p class="muted">{props.state.notice}</p>
      </Show>
      <For each={props.state.pending}>
        {(gate) => {
          const parsed = preapplyReviewSchema.safeParse(gate.payload)
          const review = parsed.success ? parsed.data : undefined
          const invalid = gate.payload !== undefined && !parsed.success
          return (
            <div class="card gate">
              <strong>{gate.title}</strong>
              <p class="muted">{gate.summary}</p>
              <Show when={review}>
                {(value) => (
                  <section class="gate-review" aria-label="Changes to approve">
                    <p class="review-path">{value().path}</p>
                    <For each={value().hunks}>
                      {(hunk, index) => (
                        <div>
                          <p class="muted">
                            Hunk {index() + 1} · −{hunk.removed} / +{hunk.added}
                          </p>
                          <pre aria-label={`Hunk ${index() + 1} diff`}>{hunk.diff}</pre>
                        </div>
                      )}
                    </For>
                    <p class="muted">
                      Approval includes every hunk shown. For selective review, use the desktop.
                    </p>
                  </section>
                )}
              </Show>
              <Show when={invalid}>
                <p class="error">Review unavailable. Deny or review on the desktop.</p>
              </Show>
              <button
                onClick={() => void decide(gate, true)}
                disabled={invalid || busyId() === gate.id}
              >
                {review ? `Approve all ${review.hunks.length} hunks` : 'Approve'}
              </button>
              <button
                class="danger"
                onClick={() => void decide(gate, false)}
                disabled={busyId() === gate.id}
              >
                Deny
              </button>
            </div>
          )
        }}
      </For>
    </Show>
  )
}
