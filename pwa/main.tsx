/**
 * pwa/main — the remote PWA: pair once, then monitor.
 *
 * A tiny two-view state machine (pair | monitor) with three monitor tabs
 * (Live / Sessions / Turn changes). Gate cards float above every tab: they
 * are the one approval surface and must always be visible. The SSE stream
 * stays open across tabs so gate snapshots stay current.
 */
import type { Component } from 'solid-js'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { api, clearToken, storedToken, type RemoteGate } from './api'
import { GateCards } from './GateCards'
import { LiveView } from './LiveView'
import { openEventStream } from './sse'
import { Pair } from './Pair'
import { SessionList } from './SessionList'
import './styles.css'

interface TurnChanges {
  changes: Array<{ path: string; status: string; totalAdded: number; totalRemoved: number }>
}

const App: Component = () => {
  const [paired, setPaired] = createSignal(Boolean(storedToken()))
  const [tab, setTab] = createSignal<'live' | 'sessions' | 'turns'>('live')
  const [gates, setGates] = createSignal<RemoteGate[]>([])
  const [turns, setTurns] = createSignal<TurnChanges | null>(null)
  const [unpairNotice, setUnpairNotice] = createSignal('')

  const refreshGates = async (): Promise<void> => {
    try {
      setGates((await api.gates()).gates)
    } catch {
      // The stream refresh will correct the snapshot.
    }
  }

  onMount(() => {
    if (!paired()) return
    void refreshGates()
    const close = openEventStream((frame) => {
      if (frame.event === 'gate_update')
        setGates((frame.data as { gates?: RemoteGate[] }).gates ?? [])
    })
    onCleanup(close)
  })

  const loadTurns = async (): Promise<void> => {
    try {
      setTurns(await api.turnChanges())
    } catch {
      setTurns({ changes: [] })
    }
  }

  const selectTab = (next: 'live' | 'sessions' | 'turns'): void => {
    setTab(next)
    if (next === 'turns') void loadTurns()
  }

  const unpair = (): void => {
    clearToken()
    setUnpairNotice('Pairing cleared on this device. The desktop device entry should be revoked.')
    setPaired(false)
  }

  return (
    <main>
      <Show
        when={paired()}
        fallback={
          <div>
            <Pair onPaired={() => setPaired(true)} />
            <Show when={unpairNotice()}>
              <p class="muted">{unpairNotice()}</p>
            </Show>
          </div>
        }
      >
        <div class="tabs">
          <button classList={{ active: tab() === 'live' }} onClick={() => selectTab('live')}>
            Live
          </button>
          <button
            classList={{ active: tab() === 'sessions' }}
            onClick={() => selectTab('sessions')}
          >
            Sessions
          </button>
          <button classList={{ active: tab() === 'turns' }} onClick={() => selectTab('turns')}>
            Changes
          </button>
        </div>

        <GateCards state={{ pending: gates(), notice: '' }} />

        <Show when={tab() === 'live'}>
          <LiveView />
        </Show>
        <Show when={tab() === 'sessions'}>
          <SessionList />
        </Show>
        <Show when={tab() === 'turns'}>
          <div>
            <h1>Turn changes</h1>
            <Show when={(turns()?.changes.length ?? 0) === 0}>
              <p class="muted">No unreviewed changes from the last turn.</p>
            </Show>
            {turns()?.changes.map((change) => (
              <div class="card">
                <div class="row">
                  <strong>{change.path}</strong>
                  <span class="badge">{change.status}</span>
                </div>
                <div class="diff">
                  <span class="add">+{change.totalAdded}</span>{' '}
                  <span class="del">−{change.totalRemoved}</span>
                </div>
              </div>
            ))}
          </div>
        </Show>

        <p>
          <button class="secondary" onClick={unpair}>
            Unpair this device
          </button>
        </p>
      </Show>
    </main>
  )
}

export default App

const root = document.getElementById('root')
if (root) render(() => <App />, root)
