import type { CustomProvider, CustomProviderModel } from '../../lib/ipc'
import type { FormErrors, FormState, LoginPhase, ModelRow } from './providerHelpers'

export function emptyForm(): FormState {
  return {
    providerId: '',
    displayName: '',
    baseUrl: '',
    apiKey: '',
    models: [{ id: '', name: '' }],
    headers: [],
  }
}

export function visibleFormErrors(
  errors: FormErrors,
  touched: Set<string>,
  patch: Partial<FormState>,
  modelCount: number
) {
  const visible: FormErrors = {}
  if ((touched.has('providerId') || patch.providerId !== undefined) && errors.providerId) {
    visible.providerId = errors.providerId
  }
  if ((touched.has('baseUrl') || patch.baseUrl !== undefined) && errors.baseUrl) {
    visible.baseUrl = errors.baseUrl
  }
  if (touched.has('models') || patch.models !== undefined) {
    if (errors.models) visible.models = errors.models
    for (let index = 0; index < modelCount; index += 1) {
      const key = `model_${index}` as const
      if (touched.has(key) && errors[key]) visible[key] = errors[key]
    }
  }
  return visible
}

export function toCustomProviderPayload(form: FormState): CustomProvider {
  const payload: CustomProvider = {
    id: form.providerId.trim(),
    baseUrl: form.baseUrl.trim(),
    models: form.models.filter((model) => model.id.trim()).map(toCustomProviderModel),
  }
  if (form.displayName.trim()) payload.name = form.displayName.trim()
  if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim()

  const headers = form.headers.filter((header) => header.key.trim() && header.value.trim())
  if (headers.length > 0) {
    payload.headers = Object.fromEntries(
      headers.map((header) => [header.key.trim(), header.value.trim()])
    )
  }
  return payload
}

export async function loginProvider(
  providerId: string,
  setLoginPhase: (phase: LoginPhase) => void
) {
  setLoginPhase({ phase: 'connecting', providerId, message: 'Starting sign-in…' })
  try {
    await window.openpi.loginProvider(providerId)
  } catch {
    // handled via event stream
  }
}

export async function logoutProvider(
  providerId: string,
  onConnected: () => void,
  loadProviders: () => Promise<void>
) {
  await window.openpi.logoutProvider(providerId)
  onConnected()
  await loadProviders()
}

export async function resolvePrompt(
  providerId: string,
  prompt: string,
  setPromptInput: (value: string) => void
) {
  await window.openpi.resolveProviderPrompt(providerId, prompt)
  setPromptInput('')
}

export async function removeProviderKey(
  providerId: string,
  onConnected: () => void,
  loadProviders: () => Promise<void>
) {
  await window.openpi.removeProviderKey(providerId)
  onConnected()
  await loadProviders()
}

export async function removeCustomProvider(providerId: string, loadProviders: () => Promise<void>) {
  await window.openpi.removeCustomProvider(providerId)
  await loadProviders()
}

function toCustomProviderModel(model: ModelRow): CustomProviderModel {
  const payload: CustomProviderModel = { id: model.id.trim() }
  if (model.name.trim()) payload.name = model.name.trim()
  return payload
}
