import { Check, Copy, ExternalLink, LogIn, LogOut } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { ProviderInfo } from '../../lib/ipc'
import type { LoginPhase, SUBSCRIPTION_PROVIDERS } from './providerHelpers'

interface SubscriptionProviderRowProps {
  provider: (typeof SUBSCRIPTION_PROVIDERS)[number]
  providers: ProviderInfo[]
  loginPhase: LoginPhase
  promptInput: string
  onPromptInput: (value: string) => void
  onPromptRef: (element: HTMLInputElement) => void
  onLogin: (providerId: string) => void
  onLogout: (providerId: string) => void
  onResolvePrompt: (providerId: string) => void
  onSelectOption: (providerId: string, optionId: string) => void
  onDismissError: () => void
}

export function SubscriptionProviderRow(props: SubscriptionProviderRowProps) {
  const info = () => props.providers.find((provider) => provider.id === props.provider.id)
  const isConnected = () => Boolean(info()?.configured && info()?.credentialType === 'oauth')
  const isActive = () =>
    props.loginPhase.phase !== 'idle' && props.loginPhase.providerId === props.provider.id
  const connectingPhase = () =>
    isActive() && props.loginPhase.phase === 'connecting' ? props.loginPhase : null
  const promptingPhase = () =>
    isActive() && props.loginPhase.phase === 'prompting' ? props.loginPhase : null
  const selectingPhase = () =>
    isActive() && props.loginPhase.phase === 'selecting' ? props.loginPhase : null
  const errorPhase = () =>
    isActive() && props.loginPhase.phase === 'error' ? props.loginPhase : null

  return (
    <div class={`cp-provider-row cp-subscription-row ${isConnected() ? 'is-connected' : ''}`}>
      <div class="cp-provider-header">
        <div class="cp-provider-info">
          <span class="cp-provider-name">{props.provider.name}</span>
          <span class="cp-provider-desc">{props.provider.description}</span>
        </div>
        <div class="cp-provider-actions">
          <Show
            when={isConnected()}
            fallback={
              <button
                type="button"
                class={`cp-sub-signin-btn ${isActive() ? 'is-loading' : ''}`}
                disabled={props.loginPhase.phase !== 'idle'}
                onClick={() => props.onLogin(props.provider.id)}
              >
                <Show when={isActive()} fallback={<LogIn size={12} strokeWidth={2.5} />}>
                  <span class="cp-sub-spinner" />
                </Show>
                <span>{isActive() ? 'Signing in…' : 'Sign in'}</span>
              </button>
            }
          >
            <div class="cp-connected-badge">
              <Check size={11} strokeWidth={2.5} />
              <span>Connected</span>
            </div>
            <button
              type="button"
              class="cp-disconnect-btn"
              onClick={() => props.onLogout(props.provider.id)}
              title="Sign out"
            >
              <LogOut size={12} strokeWidth={2} />
            </button>
          </Show>
        </div>
      </div>

      <Show when={connectingPhase()}>{(phase) => <ConnectingFlow phase={phase()} />}</Show>

      <Show when={promptingPhase()}>
        {(phase) => (
          <div class="cp-oauth-flow">
            <p class="cp-oauth-message">{phase().message}</p>
            <div class="cp-oauth-prompt-row">
              <input
                ref={props.onPromptRef}
                class="cp-key-input"
                placeholder={phase().placeholder ?? ''}
                value={props.promptInput}
                onInput={(event) => props.onPromptInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') props.onResolvePrompt(props.provider.id)
                }}
              />
              <button
                type="button"
                class="cp-key-save"
                disabled={!props.promptInput.trim() && !phase().allowEmpty}
                onClick={() => props.onResolvePrompt(props.provider.id)}
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={selectingPhase()}>
        {(phase) => (
          <div class="cp-oauth-flow">
            <p class="cp-oauth-message">{phase().message}</p>
            <div class="cp-oauth-select-options">
              <For each={phase().options}>
                {(option) => (
                  <button
                    type="button"
                    class="cp-oauth-select-option"
                    onClick={() => props.onSelectOption(props.provider.id, option.id)}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>

      <Show when={errorPhase()}>
        {(phase) => (
          <div class="cp-oauth-flow">
            <p class="cp-key-error">{phase().message}</p>
            <button type="button" class="cp-key-cancel" onClick={props.onDismissError}>
              Dismiss
            </button>
          </div>
        )}
      </Show>

      <p class="cp-subscription-note">{props.provider.note}</p>
    </div>
  )
}

interface ConnectingFlowProps {
  phase: Extract<LoginPhase, { phase: 'connecting' }>
}

function ConnectingFlow(props: ConnectingFlowProps) {
  const deviceCode = () =>
    props.phase.authInstructions?.match(/Enter code:\s*([A-Z0-9]+-[A-Z0-9]+)/i)?.[1] ?? null

  return (
    <div class="cp-oauth-flow">
      <p class="cp-oauth-message">{props.phase.message}</p>
      <Show when={props.phase.authUrl}>
        {(url) => (
          <div class="cp-oauth-url-row">
            <span class="cp-oauth-url">{url()}</span>
            <button
              type="button"
              class="cp-oauth-copy-btn"
              title="Copy URL"
              onClick={() => void navigator.clipboard.writeText(url())}
            >
              <Copy size={11} strokeWidth={2} />
            </button>
            <button
              type="button"
              class="cp-oauth-copy-btn"
              title="Open in browser"
              onClick={() => void window.openpi.openExternal(url())}
            >
              <ExternalLink size={11} strokeWidth={2} />
            </button>
          </div>
        )}
      </Show>
      <Show when={props.phase.authInstructions}>
        <Show
          when={deviceCode()}
          fallback={<p class="cp-oauth-instructions">{props.phase.authInstructions}</p>}
        >
          {(code) => (
            <div class="cp-oauth-device-code">
              <span class="cp-oauth-device-code-label">Enter this code at the URL above:</span>
              <div class="cp-oauth-device-code-row">
                <span class="cp-oauth-device-code-value">{code()}</span>
                <button
                  type="button"
                  class="cp-oauth-copy-btn"
                  title="Copy code"
                  onClick={() => void navigator.clipboard.writeText(code())}
                >
                  <Copy size={11} strokeWidth={2} />
                </button>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}
