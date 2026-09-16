/**
 * pwa/GateCards — pending approvals, the P0's only mutation surface.
 *
 * Cards arrive on the gate_update stream; decisions POST the card's one-time
 * token. 409/410 answers simply drop the card: someone else answered, or the
 * gate is gone.
 */
import { For, Show, createSignal } from 'solid-js'
import { api, ApiError, type RemoteGate } from './api'

interface GateState {
  pending: RemoteGate[]
  notice: string
}

export function GateCards(props: { state: GateState; onUnauthenticated: () => void }) {
  const [busyId, setBusyId] = createSignal('')
  const [error, setError] = createSignal('')

  const decide = async (gate: RemoteGate, approve: boolean): Promise<void> => {
    setBusyId(gate.id)
    setError('')
    try {
      await api.decideGate(gate.id, approve, gate.gateToken)
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
        {(gate) => (
          <div class="card gate">
            <strong>{gate.title}</strong>
            <p class="muted">{gate.summary}</p>
            <button onClick={() => void decide(gate, true)} disabled={busyId() === gate.id}>
              Approve
            </button>
            <button
              class="danger"
              onClick={() => void decide(gate, false)}
              disabled={busyId() === gate.id}
            >
              Deny
            </button>
          </div>
        )}
      </For>
    </Show>
  )
}
