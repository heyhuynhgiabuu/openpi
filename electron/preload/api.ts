import { eventsApi } from './events'
import { gitApi } from './git'
import { resourcesApi } from './resources'
import { remoteApi } from './remote'
import { sessionApi } from './session'
import { terminalApi } from './terminal'

export const api = {
  ...sessionApi,
  ...remoteApi,
  ...terminalApi,
  ...gitApi,
  ...resourcesApi,
  ...eventsApi,
} as const
