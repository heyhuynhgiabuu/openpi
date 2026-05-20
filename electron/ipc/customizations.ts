import fs from 'node:fs'
import path from 'node:path'
import type { IpcMain } from 'electron'
import type { CustomizationsInventory, PackageOperationResult } from '../../src/lib/ipc'
import {
  customizationsInventorySchema,
  IPC,
  packageOperationRequestSchema,
  packageOperationResultSchema,
  setExtensionEnabledRequestSchema,
} from '../../src/lib/ipc'
import type * as CustomizationsHost from '../services/customizations'

interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

interface CustomizationsIpcDeps {
  ipcMain: IpcMain
  getAgentDir: () => string
  getCwd: () => string | null
  getCustomizationsHost: () => Promise<typeof CustomizationsHost>
  isWorkspaceTrusted: (cwd: string) => boolean
  confirmHighRiskMutation: (options: ConfirmMutationOptions) => Promise<boolean>
}

export function registerCustomizationsIpc(deps: CustomizationsIpcDeps): void {
  deps.ipcMain.handle(IPC.GET_CUSTOMIZATIONS, async (): Promise<CustomizationsInventory> => {
    const { discoverCustomizations } = await deps.getCustomizationsHost()
    const cwd = deps.getCwd()
    const inventory = await discoverCustomizations({
      cwd,
      agentDir: deps.getAgentDir(),
      workspaceTrusted: cwd ? deps.isWorkspaceTrusted(cwd) : false,
    })
    return customizationsInventorySchema.parse(inventory)
  })

  deps.ipcMain.handle(IPC.GET_FIRST_RUN, async (): Promise<boolean> => {
    const sessionsDir = path.join(deps.getAgentDir(), 'sessions')
    try {
      const entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) return false
      }
    } catch {
      // sessions dir doesn't exist yet — definitely first run
    }
    return true
  })

  deps.ipcMain.handle(IPC.SET_EXTENSION_ENABLED, async (_event, raw: unknown): Promise<void> => {
    const { id, enabled } = setExtensionEnabledRequestSchema.parse(raw)
    const { setExtensionEnabled } = await deps.getCustomizationsHost()
    setExtensionEnabled(deps.getAgentDir(), id, enabled)
  })

  deps.ipcMain.handle(
    IPC.INSTALL_PACKAGE,
    async (_event, raw: unknown): Promise<PackageOperationResult> => {
      const { source, scope } = packageOperationRequestSchema.parse(raw)
      const approved = await deps.confirmHighRiskMutation({
        title: 'Install Pi package?',
        message: 'Confirm Pi package installation',
        detail: `${source} will be installed in ${scope} settings. Pi packages may provide executable extensions with full Node permissions.`,
      })
      if (!approved) {
        return packageOperationResultSchema.parse({
          ok: false,
          output: 'Package installation cancelled.',
        })
      }
      const { installCustomizationPackage } = await deps.getCustomizationsHost()
      return packageOperationResultSchema.parse(
        await installCustomizationPackage({
          cwd: deps.getCwd(),
          agentDir: deps.getAgentDir(),
          source,
          scope,
        })
      )
    }
  )

  deps.ipcMain.handle(
    IPC.REMOVE_PACKAGE,
    async (_event, raw: unknown): Promise<PackageOperationResult> => {
      const { source, scope } = packageOperationRequestSchema.parse(raw)
      const approved = await deps.confirmHighRiskMutation({
        title: 'Confirm Pi package removal',
        message: `Remove ${scope} Pi package?`,
        detail: `${source}\n\nThis mutates Pi ${scope} settings and may remove extension/skill resources from OpenPi.`,
      })
      if (!approved) return packageOperationResultSchema.parse({ ok: false, output: 'Cancelled.' })
      const { removeCustomizationPackage } = await deps.getCustomizationsHost()
      return packageOperationResultSchema.parse(
        await removeCustomizationPackage({
          cwd: deps.getCwd(),
          agentDir: deps.getAgentDir(),
          source,
          scope,
        })
      )
    }
  )
}
