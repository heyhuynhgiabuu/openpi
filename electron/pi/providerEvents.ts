import { type ProviderLoginEvent, providerLoginEventSchema } from '../../src/lib/ipc'

interface ProviderLoginRoute {
  openExternal: (url: string) => Promise<void>
  emit: (event: ProviderLoginEvent) => void
  emitError: (message: string) => void
}

export function routeProviderLoginEvent(raw: unknown, route: ProviderLoginRoute): void {
  const parsed = providerLoginEventSchema.safeParse(raw)
  if (!parsed.success) {
    route.emitError('Invalid provider authentication event.')
    return
  }

  const event = parsed.data
  const openExternal = (url: string) => {
    void route
      .openExternal(url)
      .catch(() => route.emitError('Unable to open the provider authentication URL.'))
  }

  switch (event.type) {
    case 'auth':
      openExternal(event.url)
      break
    case 'device_code':
      openExternal(event.verificationUri)
      break
    case 'progress':
    case 'prompt':
    case 'select':
    case 'success':
    case 'error':
      break
    default: {
      const _exhaustive: never = event
      throw new Error(`Unsupported provider login event: ${String(_exhaustive)}`)
    }
  }

  route.emit(event)
}
