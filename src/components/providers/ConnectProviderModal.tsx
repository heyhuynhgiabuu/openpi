// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: existing provider modal backdrop interactions are tracked separately from this release.
import { createEffect, createMemo, createSignal, onMount } from 'solid-js'
import type { CustomProviderInfo, ProviderInfo } from '../../lib/ipc'
import { getProviderLabel } from '../../lib/providers'
import { CustomProviderFormView } from './CustomProviderFormView'
import { ProviderListView } from './ProviderListView'
import {
  emptyForm,
  loginProvider,
  logoutProvider,
  removeCustomProvider,
  removeProviderKey,
  resolvePrompt,
  toCustomProviderPayload,
  visibleFormErrors,
} from './providerActions'
import {
  type FormErrors,
  type FormState,
  type HeaderRow,
  type LoginPhase,
  type ModelRow,
  POPULAR_PROVIDER_IDS,
  SUBSCRIPTION_IDS,
  SUBSCRIPTION_PROVIDERS,
  type View,
  validateForm,
} from './providerHelpers'
import { handleProviderLoginEvent } from './providerLoginEvents'

type Props = {
  onClose: () => void
  onConnected: () => void
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
  const [form, setForm] = createSignal<FormState>(emptyForm())
  const [formErrors, setFormErrors] = createSignal<FormErrors>({})
  const [formSaving, setFormSaving] = createSignal(false)
  const [touched, setTouched] = createSignal<Set<string>>(new Set<string>())
  let promptInputRef: HTMLInputElement | undefined
  let searchRef: HTMLInputElement | undefined

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
    const unsub = window.openpi.onProviderLoginEvent((event) =>
      handleProviderLoginEvent({
        event,
        setLoginPhase,
        setPromptInput,
        focusPromptInput: () => promptInputRef?.focus(),
        onConnected: props.onConnected,
        loadProviders: () => void loadProviders(),
      })
    )
    return () => unsub()
  })

  createEffect(() => {
    if (view() === 'list') setTimeout(() => searchRef?.focus(), 50)
  })

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    return providers().filter(
      (provider) =>
        !q ||
        getProviderLabel(provider.id).toLowerCase().includes(q) ||
        provider.id.toLowerCase().includes(q)
    )
  })
  const popular = createMemo(() =>
    filtered().filter(
      (provider) => POPULAR_PROVIDER_IDS.has(provider.id) && !SUBSCRIPTION_IDS.has(provider.id)
    )
  )
  const other = createMemo(() =>
    filtered().filter(
      (provider) => !POPULAR_PROVIDER_IDS.has(provider.id) && !SUBSCRIPTION_IDS.has(provider.id)
    )
  )
  const visibleSubscriptions = createMemo(() => {
    const q = search().toLowerCase()
    return SUBSCRIPTION_PROVIDERS.filter(
      (provider) =>
        !q ||
        provider.name.toLowerCase().includes(q) ||
        provider.provider.toLowerCase().includes(q) ||
        provider.id.toLowerCase().includes(q)
    )
  })

  const openCustomForm = () => {
    setView('custom-form')
    resetForm()
  }
  const resetForm = () => {
    setForm(emptyForm())
    setFormErrors({})
    setTouched(new Set<string>())
  }
  const touch = (field: string) => setTouched((prev) => new Set(prev).add(field))
  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch }
      const errors = validateForm(next)
      setFormErrors(visibleFormErrors(errors, touched(), patch, next.models.length))
      return next
    })
  }

  const addModel = () => updateForm({ models: [...form().models, { id: '', name: '' }] })
  const removeModel = (index: number) =>
    updateForm({ models: form().models.filter((_, current) => current !== index) })
  const updateModel = (index: number, patch: Partial<ModelRow>) => {
    updateForm({
      models: form().models.map((model, current) =>
        current === index ? { ...model, ...patch } : model
      ),
    })
    touch(`model_${index}`)
  }
  const addHeader = () => updateForm({ headers: [...form().headers, { key: '', value: '' }] })
  const removeHeader = (index: number) =>
    updateForm({ headers: form().headers.filter((_, current) => current !== index) })
  const updateHeader = (index: number, patch: Partial<HeaderRow>) => {
    updateForm({
      headers: form().headers.map((header, current) =>
        current === index ? { ...header, ...patch } : header
      ),
    })
  }

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
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Failed to save key')
    } finally {
      setListSaving(false)
    }
  }

  const handleSubmitCustomProvider = async () => {
    const allFields = new Set([
      'providerId',
      'baseUrl',
      'models',
      ...form().models.map((_, index) => `model_${index}`),
    ])
    setTouched(allFields)
    const errors = validateForm(form())
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setFormSaving(true)
    try {
      await window.openpi.addCustomProvider(toCustomProviderPayload(form()))
      await loadProviders()
      props.onConnected()
      setView('list')
      resetForm()
    } catch (error) {
      setFormErrors({ submit: error instanceof Error ? error.message : 'Failed to add provider' })
    } finally {
      setFormSaving(false)
    }
  }

  if (view() === 'list') {
    return (
      <ProviderListView
        providers={providers()}
        customProviders={customProviders()}
        visibleSubscriptions={visibleSubscriptions()}
        popular={popular()}
        other={other()}
        filtered={filtered()}
        search={search()}
        expandedId={expandedId()}
        apiKeyInput={apiKeyInput()}
        listError={listError()}
        listSaving={listSaving()}
        loginPhase={loginPhase()}
        promptInput={promptInput()}
        onClose={props.onClose}
        onSearch={setSearch}
        onSearchRef={(element) => {
          searchRef = element
        }}
        onPromptRef={(element) => {
          promptInputRef = element
        }}
        onPromptInput={setPromptInput}
        onAddCustom={openCustomForm}
        onToggleExpanded={(providerId) => {
          setExpandedId(expandedId() === providerId ? null : providerId)
          setApiKeyInput('')
          setListError(null)
        }}
        onApiKeyInput={setApiKeyInput}
        onCancelKey={() => {
          setExpandedId(null)
          setApiKeyInput('')
        }}
        onSaveKey={(provider) => void handleSaveKey(provider)}
        onRemoveKey={(providerId) =>
          void removeProviderKey(providerId, props.onConnected, loadProviders)
        }
        onRemoveCustom={(providerId) => void removeCustomProvider(providerId, loadProviders)}
        onSubscriptionLogin={(providerId) => void loginProvider(providerId, setLoginPhase)}
        onSubscriptionLogout={(providerId) =>
          void logoutProvider(providerId, props.onConnected, loadProviders)
        }
        onResolvePrompt={(providerId) =>
          void resolvePrompt(providerId, promptInput(), setPromptInput)
        }
        onSelectOption={(providerId, optionId) =>
          void window.openpi.resolveProviderPrompt(providerId, optionId)
        }
        onDismissLoginError={() => setLoginPhase({ phase: 'idle' })}
      />
    )
  }

  return (
    <CustomProviderFormView
      form={form()}
      formErrors={formErrors()}
      formSaving={formSaving()}
      onClose={props.onClose}
      onBack={() => setView('list')}
      onUpdateForm={updateForm}
      onTouch={touch}
      onAddModel={addModel}
      onRemoveModel={removeModel}
      onUpdateModel={updateModel}
      onAddHeader={addHeader}
      onRemoveHeader={removeHeader}
      onUpdateHeader={updateHeader}
      onSubmit={() => void handleSubmitCustomProvider()}
    />
  )
}
