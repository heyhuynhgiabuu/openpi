// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: existing provider modal backdrop interactions are tracked separately from this release.
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  LogIn,
  LogOut,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import type {
  CustomProvider,
  CustomProviderInfo,
  CustomProviderModel,
  ProviderInfo,
  ProviderLoginEvent,
} from '../../lib/ipc'
import { CUSTOM_PROVIDER_ID_RE } from '../../lib/ipc'
import { getProviderLabel } from '../../lib/providers'

const POPULAR_PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'vercel-ai-gateway',
  'opencode',
  'opencode-go',
  'groq',
  'deepseek',
  'mistral',
  'xai',
  'amazon-bedrock',
  'azure-openai-responses',
  'cloudflare-ai-gateway',
])

const SUBSCRIPTION_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Claude Pro/Max',
    provider: 'Anthropic',
    description: 'Use your Claude Pro or Max subscription',
    note: 'Billed per token from extra usage, not against plan limits',
  },
  {
    id: 'openai-codex',
    name: 'ChatGPT Plus/Pro',
    provider: 'OpenAI Codex',
    description: 'Use your ChatGPT Plus or Pro subscription',
    note: 'Officially endorsed by OpenAI for open-source coding agents',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    provider: 'GitHub',
    description: 'Use your GitHub Copilot subscription',
    note: 'Requires active Copilot subscription. If model is unsupported, enable it in VS Code first.',
  },
]

const SUBSCRIPTION_IDS = new Set(SUBSCRIPTION_PROVIDERS.map((p) => p.id))

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  anthropic: 'Direct access to Claude models via API key',
  openai: 'GPT models for fast, capable general AI tasks',
  'openai-codex': 'ChatGPT Plus/Pro Codex subscription',
  google: 'Google Gemini models',
  'github-copilot': 'AI models via GitHub Copilot',
  openrouter: 'Access multiple models through one API',
  'vercel-ai-gateway': 'Vercel AI Gateway proxy',
  opencode: 'OpenCode Zen — reliable optimized models',
  'opencode-go': 'OpenCode Go — low cost subscription',
  groq: 'Ultra-fast inference for open models',
  deepseek: 'DeepSeek reasoning models',
  mistral: 'Open and proprietary European AI models',
  xai: 'Grok models from xAI',
  'amazon-bedrock': 'AWS Bedrock model access',
  'azure-openai-responses': 'Azure-hosted OpenAI models',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway proxy',
}

type View = 'list' | 'custom-form'

type LoginPhase =
  | { phase: 'idle' }
  | {
      phase: 'connecting'
      providerId: string
      message: string
      authUrl?: string
      authInstructions?: string
    }
  | {
      phase: 'prompting'
      providerId: string
      message: string
      placeholder?: string
      allowEmpty?: boolean
    }
  | {
      phase: 'selecting'
      providerId: string
      message: string
      options: { id: string; label: string }[]
    }
  | { phase: 'error'; providerId: string; message: string }

type ModelRow = { id: string; name: string }
type HeaderRow = { key: string; value: string }

type FormState = {
  providerId: string
  displayName: string
  baseUrl: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
}

type FormErrors = Partial<Record<keyof FormState | 'submit' | `model_${number}`, string>>

type Props = {
  onClose: () => void
  onConnected: () => void
}

function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {}

  if (!form.providerId) {
    errors.providerId = 'Provider ID is required'
  } else if (!CUSTOM_PROVIDER_ID_RE.test(form.providerId)) {
    errors.providerId = 'Lowercase letters, numbers, hyphens, or underscores'
  }

  if (!form.baseUrl) {
    errors.baseUrl = 'Base URL is required'
  } else {
    try {
      new URL(form.baseUrl)
    } catch {
      errors.baseUrl = 'Must be a valid URL (e.g. https://api.example.com/v1)'
    }
  }

  const nonEmptyModels = form.models.filter((m) => m.id.trim())
  if (nonEmptyModels.length === 0) {
    errors.models = 'Add at least one model'
  }
  form.models.forEach((m, i) => {
    if (m.id.trim() === '' && (m.name.trim() !== '' || form.models.length === 1)) {
      errors[`model_${i}`] = 'Model ID is required'
    }
  })

  return errors
}

export function ConnectProviderModal(props: Props) {
  const [view, setView] = createSignal<View>('list')

  const [providers, setProviders] = createSignal<ProviderInfo[]>([])
  const [customProviders, setCustomProviders] = createSignal<CustomProviderInfo[]>([])
  const [search, setSearch] = createSignal('')
  const [expandedId, setExpandedId] = createSignal<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = createSignal('')
  const [listSaving, setListSaving] = createSignal(false)
  const [listError, setListError] = createSignal<string | null>(null)

  const [loginPhase, setLoginPhase] = createSignal<LoginPhase>({ phase: 'idle' })
  const [promptInput, setPromptInput] = createSignal('')
  let promptInputRef!: HTMLInputElement

  const emptyForm = (): FormState => ({
    providerId: '',
    displayName: '',
    baseUrl: '',
    apiKey: '',
    models: [{ id: '', name: '' }],
    headers: [],
  })

  const [form, setForm] = createSignal<FormState>(emptyForm())
  const [formErrors, setFormErrors] = createSignal<FormErrors>({})
  const [formSaving, setFormSaving] = createSignal(false)
  const [touched, setTouched] = createSignal<Set<string>>(new Set<string>())
  let searchRef!: HTMLInputElement

  const loadProviders = async () => {
    const [built, custom] = await Promise.all([
      window.openpi.getProviders().catch(() => [] as ProviderInfo[]),
      window.openpi.getCustomProviders().catch(() => [] as CustomProviderInfo[]),
    ])
    setProviders(built)
    setCustomProviders(custom)
  }

  onMount(() => {
    void loadProviders()

    const unsub = window.openpi.onProviderLoginEvent((event: ProviderLoginEvent) => {
      switch (event.type) {
        case 'progress': {
          setLoginPhase((prev) => {
            if (prev.phase === 'connecting' || prev.phase === 'prompting') {
              return { ...prev, message: event.message }
            }
            return prev
          })
          break
        }
        case 'auth': {
          setLoginPhase((prev) => {
            // GitHub Copilot device flow: the domain prompt fires first (phase becomes
            // 'prompting'), then onAuth fires with the device URL + code. We must accept
            // 'prompting' here, not just 'connecting', otherwise the device code is
            // silently dropped and the user never sees it.
            if (prev.phase === 'connecting' || prev.phase === 'prompting') {
              return {
                phase: 'connecting',
                providerId: prev.providerId,
                message: 'Open the URL below and enter the code to continue',
                authUrl: event.url,
                authInstructions: event.instructions,
              }
            }
            return prev
          })
          break
        }
        case 'prompt': {
          setPromptInput('')
          setLoginPhase((prev) => {
            if (prev.phase === 'connecting' || prev.phase === 'prompting') {
              return {
                phase: 'prompting',
                providerId: prev.providerId,
                message: event.message,
                placeholder: event.placeholder,
                allowEmpty: event.allowEmpty,
              }
            }
            return prev
          })
          setTimeout(() => promptInputRef?.focus(), 50)
          break
        }
        case 'select': {
          setLoginPhase((prev) => {
            if (prev.phase === 'connecting') {
              return {
                phase: 'selecting',
                providerId: prev.providerId,
                message: event.message,
                options: event.options,
              }
            }
            return prev
          })
          break
        }
        case 'success': {
          setLoginPhase({ phase: 'idle' })
          props.onConnected()
          void loadProviders()
          break
        }
        case 'error': {
          setLoginPhase((prev) => {
            if (prev.phase !== 'idle') {
              return {
                phase: 'error',
                providerId: prev.providerId,
                message: event.message,
              }
            }
            return prev
          })
          break
        }
      }
    })

    return () => {
      unsub()
    }
  })

  createEffect(() => {
    if (view() === 'list') setTimeout(() => searchRef?.focus(), 50)
  })

  const handleSubscriptionLogin = async (providerId: string) => {
    setLoginPhase({ phase: 'connecting', providerId, message: 'Starting sign-in…' })
    try {
      await window.openpi.loginProvider(providerId)
    } catch {
      // handled via event stream
    }
  }

  const handleSubscriptionLogout = async (providerId: string) => {
    await window.openpi.logoutProvider(providerId)
    props.onConnected()
    await loadProviders()
  }

  const handleResolvePrompt = async (providerId: string) => {
    await window.openpi.resolveProviderPrompt(providerId, promptInput())
    setPromptInput('')
  }

  const handleSelectOption = async (providerId: string, optionId: string) => {
    await window.openpi.resolveProviderPrompt(providerId, optionId)
  }

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    return providers().filter(
      (p) =>
        !q || getProviderLabel(p.id).toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    )
  })

  const popular = createMemo(() =>
    filtered().filter((p) => POPULAR_PROVIDER_IDS.has(p.id) && !SUBSCRIPTION_IDS.has(p.id))
  )
  const other = createMemo(() =>
    filtered().filter((p) => !POPULAR_PROVIDER_IDS.has(p.id) && !SUBSCRIPTION_IDS.has(p.id))
  )

  const visibleSubscriptions = createMemo(() => {
    const q = search().toLowerCase()
    return SUBSCRIPTION_PROVIDERS.filter(
      (sp) =>
        !q ||
        sp.name.toLowerCase().includes(q) ||
        sp.provider.toLowerCase().includes(q) ||
        sp.id.toLowerCase().includes(q)
    )
  })

  const handleSaveKey = async (provider: ProviderInfo) => {
    if (!apiKeyInput().trim()) return
    setListSaving(true)
    setListError(null)
    try {
      await window.openpi.setProviderKey(provider.id, apiKeyInput().trim())
      setExpandedId(null)
      setApiKeyInput('')
      props.onConnected()
      await loadProviders()
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to save key')
    } finally {
      setListSaving(false)
    }
  }

  const handleRemoveKey = async (providerId: string) => {
    await window.openpi.removeProviderKey(providerId)
    props.onConnected()
    await loadProviders()
  }

  const handleRemoveCustom = async (id: string) => {
    await window.openpi.removeCustomProvider(id)
    await loadProviders()
  }

  const touch = (field: string) => {
    setTouched((prev) => new Set(prev).add(field))
  }

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch }
      const errs = validateForm(next)
      const visibleErrs: FormErrors = {}
      const touchedSet = touched()

      if (touchedSet.has('providerId') || patch.providerId !== undefined) {
        if (errs.providerId) visibleErrs.providerId = errs.providerId
      }
      if (touchedSet.has('baseUrl') || patch.baseUrl !== undefined) {
        if (errs.baseUrl) visibleErrs.baseUrl = errs.baseUrl
      }
      if (touchedSet.has('models') || patch.models !== undefined) {
        if (errs.models) visibleErrs.models = errs.models
        next.models.forEach((_, i) => {
          const k = `model_${i}` as const
          if (touchedSet.has(k) && errs[k]) visibleErrs[k] = errs[k]
        })
      }

      setFormErrors(visibleErrs)
      return next
    })
  }

  const addModel = () => updateForm({ models: [...form().models, { id: '', name: '' }] })
  const removeModel = (i: number) =>
    updateForm({ models: form().models.filter((_, idx) => idx !== i) })
  const updateModel = (i: number, patch: Partial<ModelRow>) => {
    const next = form().models.map((m, idx) => (idx === i ? { ...m, ...patch } : m))
    updateForm({ models: next })
    touch(`model_${i}`)
  }

  const addHeader = () => updateForm({ headers: [...form().headers, { key: '', value: '' }] })
  const removeHeader = (i: number) =>
    updateForm({ headers: form().headers.filter((_, idx) => idx !== i) })
  const updateHeader = (i: number, patch: Partial<HeaderRow>) => {
    updateForm({ headers: form().headers.map((h, idx) => (idx === i ? { ...h, ...patch } : h)) })
  }

  const handleSubmitCustomProvider = async () => {
    const allFields = new Set<string>([
      'providerId',
      'baseUrl',
      'models',
      ...form().models.map((_, i) => `model_${i}`),
    ])
    setTouched(allFields)

    const errors = validateForm(form())
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setFormSaving(true)
    try {
      const payload: CustomProvider = {
        id: form().providerId.trim(),
        baseUrl: form().baseUrl.trim(),
        models: form()
          .models.filter((m) => m.id.trim())
          .map((m) => {
            const model: CustomProviderModel = { id: m.id.trim() }
            if (m.name.trim()) model.name = m.name.trim()
            return model
          }),
      }

      if (form().displayName.trim()) payload.name = form().displayName.trim()
      if (form().apiKey.trim()) payload.apiKey = form().apiKey.trim()

      const headerEntries = form().headers.filter((h) => h.key.trim() && h.value.trim())
      if (headerEntries.length > 0) {
        payload.headers = Object.fromEntries(
          headerEntries.map((h) => [h.key.trim(), h.value.trim()])
        )
      }

      await window.openpi.addCustomProvider(payload)
      await loadProviders()
      props.onConnected()
      setView('list')
      setForm(emptyForm())
      setFormErrors({})
      setTouched(new Set<string>())
    } catch (e) {
      setFormErrors({ submit: e instanceof Error ? e.message : 'Failed to add provider' })
    } finally {
      setFormSaving(false)
    }
  }

  const renderSubscriptionRow = (sp: (typeof SUBSCRIPTION_PROVIDERS)[number]) => {
    const info = () => providers().find((p) => p.id === sp.id)
    const isConnected = () => Boolean(info()?.configured && info()?.credentialType === 'oauth')
    const isActive = () => {
      const phase = loginPhase()
      return phase.phase !== 'idle' && phase.providerId === sp.id
    }

    return (
      <div class={`cp-provider-row cp-subscription-row ${isConnected() ? 'is-connected' : ''}`}>
        <div class="cp-provider-header">
          <div class="cp-provider-info">
            <span class="cp-provider-name">{sp.name}</span>
            <span class="cp-provider-desc">{sp.description}</span>
          </div>
          <div class="cp-provider-actions">
            <Show
              when={isConnected()}
              fallback={
                <button
                  type="button"
                  class={`cp-sub-signin-btn ${isActive() ? 'is-loading' : ''}`}
                  disabled={loginPhase().phase !== 'idle'}
                  onClick={() => void handleSubscriptionLogin(sp.id)}
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
                onClick={() => void handleSubscriptionLogout(sp.id)}
                title="Sign out"
              >
                <LogOut size={12} strokeWidth={2} />
              </button>
            </Show>
          </div>
        </div>

        <Show when={isActive() && loginPhase().phase === 'connecting'}>
          <div class="cp-oauth-flow">
            <p class="cp-oauth-message">
              {(loginPhase() as Extract<LoginPhase, { phase: 'connecting' }>).message}
            </p>
            <Show when={(loginPhase() as Extract<LoginPhase, { phase: 'connecting' }>).authUrl}>
              <div class="cp-oauth-url-row">
                <span class="cp-oauth-url">
                  {(loginPhase() as Extract<LoginPhase, { phase: 'connecting' }>).authUrl}
                </span>
                <button
                  type="button"
                  class="cp-oauth-copy-btn"
                  title="Copy URL"
                  onClick={() => {
                    const phase = loginPhase() as Extract<LoginPhase, { phase: 'connecting' }>
                    if (phase.authUrl) void navigator.clipboard.writeText(phase.authUrl)
                  }}
                >
                  <Copy size={11} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  class="cp-oauth-copy-btn"
                  title="Open in browser"
                  onClick={() => {
                    const phase = loginPhase() as Extract<LoginPhase, { phase: 'connecting' }>
                    if (phase.authUrl) void window.openpi.openExternal(phase.authUrl)
                  }}
                >
                  <ExternalLink size={11} strokeWidth={2} />
                </button>
              </div>
            </Show>
            <Show
              when={(loginPhase() as Extract<LoginPhase, { phase: 'connecting' }>).authInstructions}
            >
              <Show
                when={(() => {
                  const instr = (loginPhase() as Extract<LoginPhase, { phase: 'connecting' }>)
                    .authInstructions
                  return instr?.match(/Enter code:\s*([A-Z0-9]+-[A-Z0-9]+)/i)?.[1] ?? null
                })()}
                fallback={
                  <p class="cp-oauth-instructions">
                    {
                      (loginPhase() as Extract<LoginPhase, { phase: 'connecting' }>)
                        .authInstructions
                    }
                  </p>
                }
              >
                {(code) => (
                  <div class="cp-oauth-device-code">
                    <span class="cp-oauth-device-code-label">
                      Enter this code at the URL above:
                    </span>
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
        </Show>

        <Show when={isActive() && loginPhase().phase === 'prompting'}>
          <div class="cp-oauth-flow">
            <p class="cp-oauth-message">
              {(loginPhase() as Extract<LoginPhase, { phase: 'prompting' }>).message}
            </p>
            <div class="cp-oauth-prompt-row">
              <input
                ref={(el) => {
                  promptInputRef = el
                }}
                class="cp-key-input"
                placeholder={
                  (loginPhase() as Extract<LoginPhase, { phase: 'prompting' }>).placeholder ?? ''
                }
                value={promptInput()}
                onInput={(e) => setPromptInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleResolvePrompt(sp.id)
                }}
              />
              <button
                type="button"
                class="cp-key-save"
                disabled={
                  !promptInput().trim() &&
                  !(loginPhase() as Extract<LoginPhase, { phase: 'prompting' }>).allowEmpty
                }
                onClick={() => void handleResolvePrompt(sp.id)}
              >
                Continue
              </button>
            </div>
          </div>
        </Show>

        <Show when={isActive() && loginPhase().phase === 'selecting'}>
          <div class="cp-oauth-flow">
            <p class="cp-oauth-message">
              {(loginPhase() as Extract<LoginPhase, { phase: 'selecting' }>).message}
            </p>
            <div class="cp-oauth-select-options">
              <For each={(loginPhase() as Extract<LoginPhase, { phase: 'selecting' }>).options}>
                {(opt) => (
                  <button
                    type="button"
                    class="cp-oauth-select-option"
                    onClick={() => void handleSelectOption(sp.id, opt.id)}
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={isActive() && loginPhase().phase === 'error'}>
          <div class="cp-oauth-flow">
            <p class="cp-key-error">
              {(loginPhase() as Extract<LoginPhase, { phase: 'error' }>).message}
            </p>
            <button
              type="button"
              class="cp-key-cancel"
              onClick={() => setLoginPhase({ phase: 'idle' })}
            >
              Dismiss
            </button>
          </div>
        </Show>

        <p class="cp-subscription-note">{sp.note}</p>
      </div>
    )
  }

  const renderBuiltInRow = (provider: ProviderInfo) => {
    const isExpanded = () => expandedId() === provider.id
    const description = PROVIDER_DESCRIPTIONS[provider.id]

    return (
      <div class={`cp-provider-row ${provider.configured ? 'is-connected' : ''}`}>
        <div class="cp-provider-header">
          <div class="cp-provider-info">
            <span class="cp-provider-name">{getProviderLabel(provider.id)}</span>
            <Show when={description}>
              <span class="cp-provider-desc">{description}</span>
            </Show>
          </div>
          <div class="cp-provider-actions">
            <span class="cp-model-count">{provider.modelCount}m</span>
            <Show
              when={provider.configured}
              fallback={
                <button
                  type="button"
                  class={`cp-connect-btn ${isExpanded() ? 'is-active' : ''}`}
                  onClick={() => {
                    setExpandedId(isExpanded() ? null : provider.id)
                    setApiKeyInput('')
                    setListError(null)
                  }}
                  title="Add API key"
                >
                  <Plus size={12} strokeWidth={2.5} />
                </button>
              }
            >
              <div class="cp-connected-badge">
                <Check size={11} strokeWidth={2.5} />
                <span>Connected</span>
                <button
                  type="button"
                  class="cp-disconnect-btn"
                  onClick={() => void handleRemoveKey(provider.id)}
                  title="Disconnect"
                >
                  <X size={10} strokeWidth={2} />
                </button>
              </div>
            </Show>
          </div>
        </div>

        <Show when={isExpanded()}>
          <div class="cp-key-form">
            <input
              autofocus
              type="password"
              class="cp-key-input"
              placeholder={`${provider.displayName} API key`}
              value={apiKeyInput()}
              onInput={(e) => setApiKeyInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveKey(provider)
              }}
            />
            <Show when={listError()}>
              <p class="cp-key-error">{listError()}</p>
            </Show>
            <div class="cp-key-actions">
              <button
                type="button"
                class="cp-key-cancel"
                onClick={() => {
                  setExpandedId(null)
                  setApiKeyInput('')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                class="cp-key-save"
                disabled={!apiKeyInput().trim() || listSaving()}
                onClick={() => void handleSaveKey(provider)}
              >
                {listSaving() ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Show>
      </div>
    )
  }

  const renderCustomRow = (provider: CustomProviderInfo) => (
    <div class="cp-provider-row cp-custom-row">
      <div class="cp-provider-header">
        <div class="cp-provider-info">
          <span class="cp-provider-name">{provider.name}</span>
          <span class="cp-provider-desc">
            {provider.baseUrl} · {provider.modelCount}m
          </span>
        </div>
        <div class="cp-provider-actions">
          <div class="cp-connected-badge">
            <Check size={11} strokeWidth={2.5} />
            <span>Custom</span>
          </div>
          <button
            type="button"
            class="cp-disconnect-btn"
            onClick={() => void handleRemoveCustom(provider.id)}
            title="Remove provider"
          >
            <Trash2 size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )

  if (view() === 'list') {
    return (
      <div
        class="modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
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
              ref={(el) => {
                searchRef = el
              }}
              class="cp-search-input"
              placeholder="Search providers"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>

          <div class="cp-list">
            <Show when={visibleSubscriptions().length > 0}>
              <section class="cp-section cp-section--subscriptions">
                <div class="cp-group-label cp-group-label--sub">
                  Subscriptions
                  <span class="cp-group-label-hint">
                    Use your existing plan — no API key needed
                  </span>
                </div>
                <For each={visibleSubscriptions()}>{(sp) => renderSubscriptionRow(sp)}</For>
              </section>
            </Show>

            <Show when={customProviders().length > 0}>
              <section class="cp-section cp-section--custom">
                <div class="cp-group-label">Custom</div>
                <For each={customProviders()}>{(provider) => renderCustomRow(provider)}</For>
              </section>
            </Show>

            <Show when={popular().length > 0}>
              <section class="cp-section cp-section--api-key">
                <div class="cp-group-label">API Key providers</div>
                <For each={popular()}>{(provider) => renderBuiltInRow(provider)}</For>
              </section>
            </Show>

            <Show when={other().length > 0}>
              <section class="cp-section cp-section--other">
                <div class="cp-group-label">Other</div>
                <For each={other()}>{(provider) => renderBuiltInRow(provider)}</For>
              </section>
            </Show>

            <Show
              when={
                filtered().length === 0 &&
                customProviders().length === 0 &&
                visibleSubscriptions().length === 0
              }
            >
              <div class="cp-empty">No providers match "{search()}"</div>
            </Show>

            <Show when={!search()}>
              <div class="cp-add-custom-row">
                <button
                  type="button"
                  class="cp-add-custom-btn"
                  onClick={() => {
                    setView('custom-form')
                    setForm(emptyForm())
                    setFormErrors({})
                    setTouched(new Set<string>())
                  }}
                >
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

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class="modal-sheet cp-sheet">
        <div class="cp-header">
          <div class="cp-header-left">
            <button
              type="button"
              class="cp-back-btn"
              onClick={() => setView('list')}
              title="Back to provider list"
            >
              <ArrowLeft size={14} strokeWidth={2} />
            </button>
            <h2 class="cp-title">Custom provider</h2>
          </div>
          <button type="button" class="modal-close-btn" onClick={props.onClose}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        <div class="cp-custom-form-body">
          <p class="cp-custom-form-desc">
            Configure an OpenAI-compatible provider.
            <a
              class="cp-custom-form-link"
              href="https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              See provider config docs
            </a>
            .
          </p>

          <div class="cp-form-field">
            <label class="cp-form-label" for="provider-id">
              Provider ID
            </label>
            <input
              id="provider-id"
              class={`cp-form-input ${formErrors().providerId ? 'is-error' : ''}`}
              placeholder="myprovider"
              value={form().providerId}
              onInput={(e) => updateForm({ providerId: e.currentTarget.value })}
              onBlur={() => touch('providerId')}
              autofocus
              spellcheck={false}
            />
            <Show
              when={formErrors().providerId}
              fallback={
                <p class="cp-form-hint">Lowercase letters, numbers, hyphens, or underscores</p>
              }
            >
              <p class="cp-form-hint is-error">{formErrors().providerId}</p>
            </Show>
          </div>

          <div class="cp-form-field">
            <label class="cp-form-label" for="provider-display-name">
              Display name
            </label>
            <input
              id="provider-display-name"
              class="cp-form-input"
              placeholder="My AI Provider"
              value={form().displayName}
              onInput={(e) => updateForm({ displayName: e.currentTarget.value })}
            />
          </div>

          <div class="cp-form-field">
            <label class="cp-form-label" for="provider-base-url">
              Base URL
            </label>
            <input
              id="provider-base-url"
              class={`cp-form-input ${formErrors().baseUrl ? 'is-error' : ''}`}
              placeholder="https://api.myprovider.com/v1"
              value={form().baseUrl}
              onInput={(e) => updateForm({ baseUrl: e.currentTarget.value })}
              onBlur={() => touch('baseUrl')}
              spellcheck={false}
            />
            <Show when={formErrors().baseUrl}>
              <p class="cp-form-hint is-error">{formErrors().baseUrl}</p>
            </Show>
          </div>

          <div class="cp-form-field">
            <label class="cp-form-label" for="provider-api-key">
              API key
            </label>
            <input
              id="provider-api-key"
              class="cp-form-input"
              type="password"
              placeholder="API key"
              value={form().apiKey}
              onInput={(e) => updateForm({ apiKey: e.currentTarget.value })}
              autocomplete="off"
            />
            <p class="cp-form-hint">Optional. Leave empty if you manage auth via headers.</p>
          </div>

          <div class="cp-form-field">
            <span class="cp-form-label">Models</span>
            <Show when={formErrors().models}>
              <p class="cp-form-hint is-error" style={{ 'margin-bottom': '6px' }}>
                {formErrors().models}
              </p>
            </Show>
            <div class="cp-models-list">
              <For each={form().models}>
                {(m, i) => (
                  <div class="cp-model-row">
                    <div class="cp-model-inputs">
                      <input
                        class={`cp-form-input cp-model-id-input ${formErrors()[`model_${i()}` as const] ? 'is-error' : ''}`}
                        placeholder="model-id"
                        value={m.id}
                        onInput={(e) => updateModel(i(), { id: e.currentTarget.value })}
                        onBlur={() => touch(`model_${i()}`)}
                        spellcheck={false}
                      />
                      <input
                        class="cp-form-input cp-model-name-input"
                        placeholder="Display Name"
                        value={m.name}
                        onInput={(e) => updateModel(i(), { name: e.currentTarget.value })}
                      />
                    </div>
                    <Show when={form().models.length > 1}>
                      <button
                        type="button"
                        class="cp-model-remove-btn"
                        onClick={() => removeModel(i())}
                        title="Remove model"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <button type="button" class="cp-add-row-btn" onClick={addModel}>
              <Plus size={12} strokeWidth={2.5} />
              Add model
            </button>
          </div>

          <div class="cp-form-field">
            <span class="cp-form-label">
              Headers <span class="cp-form-label-optional">(optional)</span>
            </span>
            <Show when={form().headers.length > 0}>
              <div class="cp-models-list">
                <For each={form().headers}>
                  {(h, i) => (
                    <div class="cp-model-row">
                      <div class="cp-model-inputs">
                        <input
                          class="cp-form-input cp-model-id-input"
                          placeholder="Header-Name"
                          value={h.key}
                          onInput={(e) => updateHeader(i(), { key: e.currentTarget.value })}
                          spellcheck={false}
                        />
                        <input
                          class="cp-form-input cp-model-name-input"
                          placeholder="value"
                          value={h.value}
                          onInput={(e) => updateHeader(i(), { value: e.currentTarget.value })}
                          spellcheck={false}
                        />
                      </div>
                      <button
                        type="button"
                        class="cp-model-remove-btn"
                        onClick={() => removeHeader(i())}
                        title="Remove header"
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <button type="button" class="cp-add-row-btn" onClick={addHeader}>
              <Plus size={12} strokeWidth={2.5} />
              Add header
            </button>
          </div>

          <Show when={formErrors().submit}>
            <p class="cp-key-error" style={{ 'margin-bottom': '8px' }}>
              {formErrors().submit}
            </p>
          </Show>

          <div class="cp-custom-form-actions">
            <button
              type="button"
              class="cp-key-save"
              disabled={formSaving()}
              onClick={() => void handleSubmitCustomProvider()}
            >
              {formSaving() ? 'Adding…' : 'Add provider'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
