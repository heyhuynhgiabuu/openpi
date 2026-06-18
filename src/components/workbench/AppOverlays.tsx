import { Show } from 'solid-js'
import type { ModelInfo } from '../../lib/ipc'
import { CommandPalette, type PaletteCommand } from '../CommandPalette'
import { type ActiveTab, CustomizationsModal } from '../customizations/CustomizationsModal'
import { FileSearchModal } from '../git/FileSearchModal'
import { ConnectProviderModal } from '../providers/ConnectProviderModal'
import { ManageModelsModal } from '../providers/ManageModelsModal'
import { ArchiveConfirmModal } from '../sidebar/ArchiveConfirmModal'

interface ArchivePending {
  label: string
  paths: string[]
}

interface AppOverlaysProps {
  cwd: string | null
  fileSearchOpen: boolean
  commandPaletteOpen: boolean
  customizationsOpen: boolean
  customizationsInitialTab?: ActiveTab
  connectProviderOpen: boolean
  manageModelsOpen: boolean
  archivePending: ArchivePending | null
  commands: PaletteCommand[]
  sessions: Parameters<typeof CommandPalette>[0]['sessions']
  appName: string
  appVersionLabel: string | null
  models: ModelInfo[]
  currentModel: ModelInfo | null
  hiddenModels: Set<string>
  onCloseFileSearch: () => void
  onOpenFile: (path: string) => void
  onCloseCommandPalette: () => void
  onOpenSession: Parameters<typeof CommandPalette>[0]['onOpenSession']
  onCloseCustomizations: () => void
  onSelectModel: (model: ModelInfo) => void
  onError: (error: string | null) => void
  onCloseConnectProvider: () => void
  onProviderConnected: () => void
  onArchiveConfirm: (skipNext: boolean) => void
  onArchiveCancel: () => void
  onToggleHiddenModel: (key: string) => void
  onCloseManageModels: () => void
  onConnectProviderFromModels: () => void
}

export function AppOverlays(props: AppOverlaysProps) {
  return (
    <>
      <Show when={props.fileSearchOpen}>
        <FileSearchModal
          cwd={props.cwd}
          onClose={props.onCloseFileSearch}
          onFileClick={props.onOpenFile}
        />
      </Show>

      <Show when={props.commandPaletteOpen}>
        <CommandPalette
          cwd={props.cwd}
          commands={props.commands}
          sessions={props.sessions}
          onClose={props.onCloseCommandPalette}
          onOpenFile={props.onOpenFile}
          onOpenSession={props.onOpenSession}
        />
      </Show>

      <CustomizationsModal
        open={props.customizationsOpen}
        appName={props.appName}
        appVersionLabel={props.appVersionLabel}
        models={props.models}
        currentModel={props.currentModel}
        onSelectModel={props.onSelectModel}
        onClose={props.onCloseCustomizations}
        onError={props.onError}
        cwd={props.cwd}
        initialTab={props.customizationsInitialTab}
      />

      <Show when={props.connectProviderOpen}>
        <ConnectProviderModal
          onClose={props.onCloseConnectProvider}
          onConnected={props.onProviderConnected}
        />
      </Show>

      <Show when={props.archivePending}>
        {(getPending) => (
          <ArchiveConfirmModal
            workspaceName={getPending().label}
            sessionCount={getPending().paths.length}
            onConfirm={props.onArchiveConfirm}
            onCancel={props.onArchiveCancel}
          />
        )}
      </Show>

      <Show when={props.manageModelsOpen}>
        <ManageModelsModal
          models={props.models}
          hiddenModels={props.hiddenModels}
          onToggle={props.onToggleHiddenModel}
          onClose={props.onCloseManageModels}
          onConnectProvider={props.onConnectProviderFromModels}
        />
      </Show>
    </>
  )
}
