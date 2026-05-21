/**
 * lib barrel — convenience re-exports for commonly used modules.
 *
 * Components can import from '../lib' instead of specific paths:
 *   import { IPC, type ModelInfo } from '../lib'
 *
 * This is optional — direct imports continue to work.
 */

export * from './appearancePreferences'
export * from './displayPreferences'
export * from './extensionTrackers'
export * from './fileIcons'
export * from './fileLineComments'
export * from './fileMentions'
export * from './ipc'
export * from './keybindings'
export * from './notificationPreferences'
export * from './panelLayout'
export * from './promptContext'
export * from './providers'
export * from './sessionEvents'
export * from './sessionPrompt'
export * from './sessionView'
export * from './shiki'
export * from './soundPreferences'
export * from './syncBridge'
export * from './themeApply'
export * from './updatePreferences'
export * from './utils'
