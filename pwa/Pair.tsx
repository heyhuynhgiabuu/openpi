/**
 * pwa/Pair — the pairing screen: code + device name, nothing else.
 *
 * A successful pair stores the device token (shown once by the server) and
 * moves the app to the monitoring views.
 */
import { createSignal, Show } from 'solid-js'
import { api, ApiError, storeToken } from './api'

export function Pair(props: { onPaired: () => void }) {
  const [code, setCode] = createSignal('')
  const [name, setName] = createSignal('phone')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault()
    const digits = code().replace(/\D/g, '')
    if (digits.length !== 6) {
      setError('Enter the 6-digit code shown on the desktop.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { deviceToken } = await api.pair(digits, name().trim() || 'phone')
      storeToken(deviceToken)
      props.onPaired()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'bad_code'
            ? 'That code did not match. Generate a new one on the desktop if it expired.'
            : err.code === 'rate_limited'
              ? 'Too many attempts. Wait five minutes and try again.'
              : `Pairing failed (${err.status}).`
        )
      } else {
        setError('Pairing failed. Are you on the tailnet?')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>Pair with OpenPi</h1>
      <p class="muted">
        Open OpenPi on your desktop, open Settings → Remote → “Pair a device”, and type the 6-digit
        code here.
      </p>
      <form onSubmit={submit}>
        <div class="card">
          <input
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="000000"
            maxlength={6}
            value={code()}
            onInput={(event) => setCode(event.currentTarget.value)}
            aria-label="Pairing code"
          />
        </div>
        <div class="card">
          <input
            placeholder="Device name"
            maxlength={64}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            aria-label="Device name"
          />
        </div>
        <Show when={error()}>
          <p class="error">{error()}</p>
        </Show>
        <button type="submit" disabled={busy()}>
          {busy() ? 'Pairing…' : 'Pair'}
        </button>
      </form>
    </div>
  )
}
