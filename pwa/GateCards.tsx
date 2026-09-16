/**
 * pwa/GateCards — pending approvals, the P0's only mutation surface.
 *
 * Cards arrive on the gate_update stream; decisions POST the card's one-time
 * token. 409/410 answers simply drop the card: someone else answered, or the
 * gate is gone.
 */
import { For, Show, createSignal } from 'solid-js'
import { api, type RemoteGate } from './api'

interface GateState {
  pending: RemoteGate[]
  notice: string
}

export function GateCards(props: { state: GateState }) {
  const [busyId, setBusyId] = createSignal('')
  const [error, setError] = createSignal('')

  const decide = async (gate: RemoteGate, approve: boolean): Promise<void> => {
    setBusyId(gate.id)
    setError('')
    try {
      await api.decideGate(gate.id, approve, gate.gateToken)
    } catch {
      // 409/410 mean the gate resolved elsewhere or expired — the next
      // gate_update snapshot drops the card. Surface anything else.
      setError('The gate was answered elsewhere or has expired.')
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
