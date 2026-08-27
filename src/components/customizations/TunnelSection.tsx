import { Check, Copy, QrCode } from 'lucide-solid'
import { createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { TunnelStatus } from '../../../electron/ipc/tunnel'

/**
 * DNS-safe zrok reserved name: `^[a-z0-9][a-z0-9-]{0,62}$`, max 63 chars.
 * Mirrors the enforcement in Electron main (electron/ipc/tunnel.ts).
 */
const DNS_SAFE_RESERVED_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

type UiState =
  | 'not-installed'
  | 'not-enrolled'
  | 'disconnected'
  | 'connected'
  | 'starting'
  | 'error'

interface TunnelSectionProps {
  onError: (message: string) => void
}

export function TunnelSection(props: TunnelSectionProps) {
  const [status, setStatus] = createSignal<TunnelStatus>({ state: 'off' })
  const [busy, setBusy] = createSignal(false)
  const [token, setToken] = createSignal('')
  const [reservedName, setReservedName] = createSignal('')
  const [touched, setTouched] = createSignal(false)
  const [qrData, setQrData] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setInterval> | undefined

  const enrolled = () => Boolean(status().enrolled)
  const installed = () => status().installed !== false

  const uiState = (): UiState => {
    const s = status()
    if (!installed()) return 'not-installed'
    if (!enrolled()) return 'not-enrolled'
    if (s.state === 'running' && s.url) return 'connected'
    if (s.state === 'starting') return 'starting'
    if (s.state === 'error') return 'error'
    return 'disconnected'
  }

  const url = () => status().url ?? null

  const refresh = async () => {
    try {
      setStatus(await window.openpi.getStatus())
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    }
  }

  const loadQr = async () => {
    const target = url()
    if (!target) {
      setQrData(null)
      return
    }
    try {
      setQrData(await window.openpi.generateQr(target))
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    }
  }

  const copyUrl = async () => {
    const target = url()
    if (!target) return
    try {
      await navigator.clipboard.writeText(target)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    }
  }

  const connect = async () => {
    setBusy(true)
    try {
      const name = reservedName().trim()
      if (name && !DNS_SAFE_RESERVED_NAME_RE.test(name)) {
        props.onError('Reserved name must be DNS-safe: lowercase letters, digits, hyphens only.')
        return
      }
      const result = await window.openpi.enable(token().trim(), false, name || undefined)
      if (result.ok) {
        setToken('')
        await refresh()
        await loadQr()
      } else {
        props.onError(result.error ?? 'Could not connect the tunnel.')
      }
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await window.openpi.disable()
      setQrData(null)
      await refresh()
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const nameInvalid = () => {
    const name = reservedName().trim()
    return touched() && name.length > 0 && !DNS_SAFE_RESERVED_NAME_RE.test(name)
  }

  const openDocs = () => {
    void window.openpi.openExternal('https://docs.zrok.io')
  }

  onMount(() => {
    void refresh().then(() => loadQr())
    // Reflect the running/starting transition while the tunnel is active.
    timer = setInterval(() => {
      const state = status().state
      if (state === 'running' || state === 'starting') void refresh()
    }, 2000)
  })

  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  return (
    <section id="tunnel-section" class="osp-section">
      <div class="osp-section-head">Remote access (zrok tunnel)</div>

      <Show when={uiState() === 'not-installed'}>
        <div class="osp-row osp-row-last">
          <div class="osp-row-left">
            <div class="osp-row-name">zrok is not installed</div>
            <div class="osp-row-desc">
              The zrok CLI was not found on PATH. Install it to expose the local dashboard over a
              private tunnel (HTTPS + basic auth). Example: <code>brew install zrok</code>.
            </div>
          </div>
          <div class="osp-row-right osp-row-right-actions">
            <div class="osp-action-group">
              <button class="osp-action-btn" type="button" onClick={openDocs}>
                zrok docs
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={uiState() === 'not-enrolled'}>
        <div class="osp-row">
          <div class="osp-row-left">
            <div class="osp-row-name">Connect your zrok account</div>
            <div class="osp-row-desc">
              Paste a zrok token from <code>zrok.io</code> to enable local tunneling. The token is
              stored in the Electron main process (never exposed to the renderer).
            </div>
          </div>
        </div>
        <div class="osp-row osp-row-last osp-row--stacked">
          <div class="osp-row-left">
            <input
              class="osp-input"
              type="password"
              placeholder="zrok token"
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
            />
            <div class="osp-row-desc">
              Optional reserved name (DNS-safe, lowercase + digits + hyphens):
            </div>
            <input
              class="osp-input"
              type="text"
              placeholder="pi-dash-abc123"
              value={reservedName()}
              onInput={(e) => {
                setReservedName(e.currentTarget.value)
                setTouched(true)
              }}
            />
            <Show when={nameInvalid()}>
              <div class="osp-update-status" style="color:#f87171">
                Invalid name: use lowercase letters, digits and hyphens only (max 63 chars).
              </div>
            </Show>
          </div>
          <div class="osp-row-right osp-row-right-actions">
            <div class="osp-action-group">
              <button
                class="osp-action-btn osp-action-btn-primary"
                type="button"
                disabled={busy() || !token().trim()}
                onClick={connect}
              >
                {busy() ? 'Enabling…' : 'Enable'}
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={uiState() === 'error'}>
        <div class="osp-row osp-row-last">
          <div class="osp-row-left">
            <div class="osp-row-name">Tunnel error</div>
            <div class="osp-row-desc">{status().error ?? 'Unknown zrok error.'}</div>
          </div>
          <div class="osp-row-right osp-row-right-actions">
            <div class="osp-action-group">
              <button class="osp-action-btn" type="button" onClick={disconnect}>
                Stop
              </button>
              <button
                class="osp-action-btn osp-action-btn-primary"
                type="button"
                disabled={busy()}
                onClick={connect}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={uiState() === 'disconnected' || uiState() === 'starting'}>
        <div class="osp-row osp-row-last">
          <div class="osp-row-left">
            <div class="osp-row-name">
              {uiState() === 'starting' ? 'Starting tunnel…' : 'Tunnel is disconnected'}
            </div>
            <div class="osp-row-desc">
              Start a private zrok tunnel to reach the local dashboard from a browser on another
              device. Connections require HTTP basic auth.
            </div>
          </div>
          <div class="osp-row-right osp-row-right-actions">
            <div class="osp-action-group">
              <button
                class="osp-action-btn osp-action-btn-primary"
                type="button"
                disabled={busy()}
                onClick={connect}
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={uiState() === 'connected' && url()}>
        {(resolved) => (
          <div class="osp-row osp-row-last">
            <div class="osp-row-left">
              <div class="osp-row-name">
                Tunnel is live
                <Show when={copied()}>
                  <span class="osp-saved-inline">
                    <Check size={10} /> copied
                  </span>
                </Show>
              </div>
              <div class="osp-row-desc">{resolved()}</div>
              <Show when={qrData()}>
                <img
                  src={qrData()!}
                  alt="Tunnel QR code"
                  style="margin-top:10px;width:160px;height:160px;image-rendering:pixelated;border-radius:var(--r-sm);border:1px solid var(--hairline-strong)"
                />
              </Show>
            </div>
            <div class="osp-row-right osp-row-right-actions">
              <div class="osp-action-group">
                <button class="osp-action-btn" type="button" onClick={copyUrl} disabled={!url()}>
                  <Copy size={13} /> Copy URL
                </button>
                <button
                  class="osp-action-btn"
                  type="button"
                  onClick={() => {
                    setQrData(null)
                    void loadQr()
                  }}
                >
                  <QrCode size={13} /> Refresh QR
                </button>
                <button class="osp-action-btn" type="button" onClick={disconnect} disabled={busy()}>
                  Disconnect
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </section>
  )
}
