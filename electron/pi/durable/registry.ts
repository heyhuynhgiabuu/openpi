import type { Registry } from '@earendil-works/pi-durable'
import { ToolTask, defineExtension, hook } from '@earendil-works/pi-durable'
import type { CustomizationDiagnostic } from '../../../src/lib/ipc'
import { loadCustomizationsExtension } from './sections'
import type { DurableCustomizations } from './customizations'
import { policyToolHooks } from './policy'

/**
 * The extensions an open installs before the harness exists, and the customizations they came from.
 *
 * Split out of `harness.ts` for size, and because it is one concern: parity with the SDK path.
 * Customizations render as prompt sections; the policy gate mirrors the desktop protected-path and
 * high-risk gates Electron main applies on the SDK path.
 */
export interface PreparedRegistry {
  /** Undefined when the caller gave no agent dir, which `/`-templates and prompts need. */
  customizations?: DurableCustomizations
  /** Warnings to surface; never a reason to fail the open. */
  diagnostics: CustomizationDiagnostic[]
}

/** Install the parity extensions into `registry` and report what loading them found. */
export async function prepareRegistry(
  registry: Registry,
  options: { userAgentDir?: string; workspacePath?: string | null; policy?: boolean }
): Promise<PreparedRegistry> {
  const diagnostics: CustomizationDiagnostic[] = []
  let customizations: DurableCustomizations | undefined
  if (options.userAgentDir) {
    const loaded = await loadCustomizationsExtension({
      userAgentDir: options.userAgentDir,
      workspacePath: options.workspacePath,
    })
    registry.install(loaded.extension)
    customizations = loaded.found
    diagnostics.push(...loaded.found.diagnostics)
  }
  if (options.policy !== false) {
    registry.install(
      defineExtension({
        name: 'openpi.policy',
        hooks: [hook(ToolTask, policyToolHooks({ workspacePath: options.workspacePath }))],
      })
    )
  }
  return { customizations, diagnostics }
}
