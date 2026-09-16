/**
 * RemoteSection — Settings → Remote: the only desktop surface that controls
 * the remote P0 server. Toggle (persisted, restored on relaunch), pairing
 * code display, and the paired-device list with immediate revocation.
 * Render-only: every action is an IPC call; decisions live in main.
 */
import { For, Show, createResource, createSignal } from 'solid-js'
import type { RemoteStatus } from '../../lib/ipc'

interface PairingCode {
  code: string
  expiresAt: number
}

export function RemoteSection(props: { onError: (message: string) => void }) {
  const [status, { refetch }] = createResource<RemoteStatus>(window.openpi.remoteStatus)
  const [pairing, setPairing] = createSignal<PairingCode | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const setEnabled = (enabled: boolean): void => {
    void run(async () => {
      await window.openpi.remoteSetEnabled(enabled)
      if (!enabled) setPairing(null)
      await refetch()
    })
  }

  const beginPairing = (): void => {
    void run(async () => {
      setPairing(await window.openpi.remoteBeginPairing())
      setCopied(false)
    })
  }

  const cancelPairing = (): void => {
    void run(async () => {
      await window.openpi.remoteCancelPairing()
      setPairing(null)
    })
  }

  const revoke = (id: number): void => {
    void run(async () => {
      await window.openpi.remoteRevokeDevice(id)
      await refetch()
    })
  }

  const copyCode = (): void => {
    void navigator.clipboard.writeText(pairing()?.code ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const expiresIn = (): string => {
    const seconds = Math.max(0, Math.round(((pairing()?.expiresAt ?? 0) - Date.now()) / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }

  return (
    <section class="osp-section">
      <div class="osp-section-head">Remote</div>

      <div class="osp-row">
        <div class="osp-row-left">
          <div class="osp-row-name">Remote monitoring</div>
          <div class="osp-row-desc">
            Let paired devices on your tailnet watch sessions and approve gates at
            http://&lt;this-mac&gt;:8787. The server stays off unless enabled here.
          </div>
          <Show when={status()?.enabled}>
            <div class="osp-row-desc">Serving on port {status()?.port}.</div>
          </Show>
        </div>
        <div class="osp-row-right">
          <button
            class="osp-reset-btn"
            disabled={busy() || status.loading}
            onClick={() => setEnabled(!(status()?.enabled ?? false))}
          >
            {status()?.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      <Show when={status()?.enabled}>
        <div class="osp-row">
          <div class="osp-row-left">
            <div class="osp-row-name">Pair a device</div>
            <div class="osp-row-desc">
              Generates a 6-digit code, valid for 5 minutes. Enter it in OpenPi Remote on the phone.
            </div>
            <Show when={pairing()}>
              <div class="osp-row-name" style={{ 'font-size': '22px', 'letter-spacing': '0.3em' }}>
                {pairing()?.code}
              </div>
              <div class="osp-row-desc">
                Expires in {expiresIn()} ·{' '}
                <Show
                  when={copied()}
                  fallback={
                    <button class="osp-reset-btn" onClick={copyCode}>
                      Copy
                    </button>
                  }
                >
                  copied
                </Show>
              </div>
            </Show>
          </div>
          <div class="osp-row-right">
            <Show
              when={pairing()}
              fallback={
                <button class="osp-reset-btn" disabled={busy()} onClick={beginPairing}>
                  Show code
                </button>
              }
            >
              <button class="osp-reset-btn" disabled={busy()} onClick={cancelPairing}>
                Cancel
              </button>
            </Show>
          </div>
        </div>

        <div class="osp-row">
          <div class="osp-row-left">
            <div class="osp-row-name">Devices</div>
            <div class="osp-row-desc">
              <For each={status()?.devices ?? []}>
                {(device) => (
                  <div>
                    {device.name}
                    <Show when={device.revokedAt}> (revoked)</Show>
                    <span class="osp-row-desc">
                      {device.revokedAt
                        ? ''
                        : ` · last seen ${device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : 'never'}`}
                    </span>
                  </div>
                )}
              </For>
              <Show when={(status()?.devices ?? []).length === 0}>No devices paired yet.</Show>
            </div>
          </div>
        </div>
        <For each={(status()?.devices ?? []).filter((device) => !device.revokedAt)}>
          {(device) => (
            <div class="osp-row">
              <div class="osp-row-left">
                <div class="osp-row-name">{device.name}</div>
                <div class="osp-row-desc">paired {new Date(device.createdAt).toLocaleString()}</div>
              </div>
              <div class="osp-row-right">
                <button class="osp-reset-btn" disabled={busy()} onClick={() => revoke(device.id)}>
                  Revoke
                </button>
              </div>
            </div>
          )}
        </For>
      </Show>
    </section>
  )
}
