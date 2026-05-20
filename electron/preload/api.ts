import { eventsApi } from './events'
import { gitApi } from './git'
import { resourcesApi } from './resources'
import { sessionApi } from './session'
import { terminalApi } from './terminal'

export const api = {
  ...sessionApi,
  ...terminalApi,
  ...gitApi,
  ...resourcesApi,
  ...eventsApi,
} as const
