import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import {
  type ExtensionUiBridgeSinks,
  emitExtensionNotify,
  extensionNotifyLevelFromPi,
} from './extensionUiBridge'

/** Pi sidecar UI bridge: extension `ctx.ui.notify` and dialogs (minimal RPC parity). */
export function createOpenPiExtensionUIContext(sinks: ExtensionUiBridgeSinks): ExtensionUIContext {
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify(message, type) {
      emitExtensionNotify(sinks, extensionNotifyLevelFromPi(type), message)
    },
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: (async () => undefined) as ExtensionUIContext['custom'],
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    editor: async () => undefined,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return {} as ExtensionUIContext['theme']
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'Theme switching not supported in OpenPi' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  }
}
