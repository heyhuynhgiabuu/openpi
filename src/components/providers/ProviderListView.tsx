// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: preserves existing provider modal backdrop click behavior.
import { Search, Sparkles, X } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { CustomProviderInfo, ProviderInfo } from '../../lib/ipc'
import { BuiltInProviderRow } from './BuiltInProviderRow'
import { CustomProviderRow } from './CustomProviderRow'
import type { LoginPhase, SUBSCRIPTION_PROVIDERS } from './providerHelpers'
import { SubscriptionProviderRow } from './SubscriptionProviderRow'

interface ProviderListViewProps {
  providers: ProviderInfo[]
  customProviders: CustomProviderInfo[]
  visibleSubscriptions: typeof SUBSCRIPTION_PROVIDERS
  popular: ProviderInfo[]
  other: ProviderInfo[]
  filtered: ProviderInfo[]
  search: string
  expandedId: string | null
  apiKeyInput: string
  listError: string | null
  listSaving: boolean
  loginPhase: LoginPhase
  promptInput: string
  onClose: () => void
  onSearch: (value: string) => void
  onSearchRef: (element: HTMLInputElement) => void
  onPromptRef: (element: HTMLInputElement) => void
  onPromptInput: (value: string) => void
  onAddCustom: () => void
  onToggleExpanded: (providerId: string) => void
  onApiKeyInput: (value: string) => void
  onCancelKey: () => void
  onSaveKey: (provider: ProviderInfo) => void
  onRemoveKey: (providerId: string) => void
  onRemoveCustom: (providerId: string) => void
  onSubscriptionLogin: (providerId: string) => void
  onSubscriptionLogout: (providerId: string) => void
  onResolvePrompt: (providerId: string) => void
  onSelectOption: (providerId: string, optionId: string) => void
  onDismissLoginError: () => void
}

export function ProviderListView(props: ProviderListViewProps) {
  const renderBuiltInRow = (provider: ProviderInfo) => (
    <BuiltInProviderRow
      provider={provider}
      expanded={props.expandedId === provider.id}
      apiKeyInput={props.apiKeyInput}
      listError={props.listError}
      listSaving={props.listSaving}
      onExpand={() => props.onToggleExpanded(provider.id)}
      onApiKeyInput={props.onApiKeyInput}
      onCancel={props.onCancelKey}
      onSave={() => props.onSaveKey(provider)}
      onRemove={() => props.onRemoveKey(provider.id)}
    />
  )

  return (
    <div
      class="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div class="modal-sheet cp-sheet">
        <div class="cp-header">
          <h2 class="cp-title">Connect provider</h2>
          <button type="button" class="modal-close-btn" onClick={props.onClose}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        <div class="cp-search-row">
          <Search size={13} strokeWidth={2} class="cp-search-icon" />
          <input
            ref={props.onSearchRef}
            class="cp-search-input"
            placeholder="Search providers"
            value={props.search}
            onInput={(event) => props.onSearch(event.currentTarget.value)}
          />
        </div>

        <div class="cp-list">
          <Show when={props.visibleSubscriptions.length > 0}>
            <section class="cp-section cp-section--subscriptions">
              <div class="cp-group-label cp-group-label--sub">
                Subscriptions
                <span class="cp-group-label-hint">Use your existing plan — no API key needed</span>
              </div>
              <For each={props.visibleSubscriptions}>
                {(provider) => (
                  <SubscriptionProviderRow
                    provider={provider}
                    providers={props.providers}
                    loginPhase={props.loginPhase}
                    promptInput={props.promptInput}
                    onPromptInput={props.onPromptInput}
                    onPromptRef={props.onPromptRef}
                    onLogin={props.onSubscriptionLogin}
                    onLogout={props.onSubscriptionLogout}
                    onResolvePrompt={props.onResolvePrompt}
                    onSelectOption={props.onSelectOption}
                    onDismissError={props.onDismissLoginError}
                  />
                )}
              </For>
            </section>
          </Show>

          <Show when={props.customProviders.length > 0}>
            <section class="cp-section cp-section--custom">
              <div class="cp-group-label">Custom</div>
              <For each={props.customProviders}>
                {(provider) => (
                  <CustomProviderRow
                    provider={provider}
                    onRemove={() => props.onRemoveCustom(provider.id)}
                  />
                )}
              </For>
            </section>
          </Show>

          <Show when={props.popular.length > 0}>
            <section class="cp-section cp-section--api-key">
              <div class="cp-group-label">API Key providers</div>
              <For each={props.popular}>{renderBuiltInRow}</For>
            </section>
          </Show>

          <Show when={props.other.length > 0}>
            <section class="cp-section cp-section--other">
              <div class="cp-group-label">Other</div>
              <For each={props.other}>{renderBuiltInRow}</For>
            </section>
          </Show>

          <Show
            when={
              props.filtered.length === 0 &&
              props.customProviders.length === 0 &&
              props.visibleSubscriptions.length === 0
            }
          >
            <div class="cp-empty">No providers match "{props.search}"</div>
          </Show>

          <Show when={!props.search}>
            <div class="cp-add-custom-row">
              <button type="button" class="cp-add-custom-btn" onClick={props.onAddCustom}>
                <Sparkles size={13} strokeWidth={2} class="cp-add-custom-icon" />
                <span>Custom provider</span>
                <span class="cp-add-custom-hint">OpenAI-compatible</span>
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
