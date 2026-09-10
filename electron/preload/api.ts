import { eventsApi } from './events'
import { gitApi } from './git'
import { resourcesApi } from './resources'
import { sessionApi } from './session'
import { terminalApi } from './terminal'
import { tunnelApi } from './tunnel'

export const api = {
  ...sessionApi,
  ...terminalApi,
  ...gitApi,
  ...resourcesApi,
  ...tunnelApi,
  ...eventsApi,
} as const
