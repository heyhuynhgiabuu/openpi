import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import type { CustomizationDiagnostic } from '../../../src/lib/ipc'

/**
 * The part of the model runtime this needs; `ModelRuntime` satisfies it structurally, which keeps
 * the tests free of a real runtime and its auth files.
 */
export interface ProviderRegistrar {
  // `ProviderConfig` is what the extension-facing `registerProvider` takes, and it is assignable to
  // what `ModelRuntime.registerProvider` wants, so the real runtime satisfies this without a cast.
  registerProvider(providerId: string, config: ProviderConfig): void
}

export interface ExtensionProviderRoots {
  /** The global Pi agent dir; its `extensions/` is the user's own code. */
  agentDir: string
  /**
   * Workspace whose `.pi/extensions` must NOT be loaded. Only used to give the loader a cwd, since
   * project-local extensions are excluded (`noExtensions`).
   */
  cwd?: string
  models: ProviderRegistrar
}

/**
 * Load global Pi extensions and register the model providers they declare.
 *
 * The durable runtime loads no extensions (`customizations.ts` sets `noExtensions`), so a user whose
 * only model comes from an extension — `copilot-provider.ts` registering `github-copilot` is the
 * example the shipped path names — starts a session here and is told "no model has credentials".
 * This closes that: register the providers before the model is chosen.
 *
 * ## Only global extensions, deliberately
 *
 * Project-local `.pi/extensions` are excluded even in a trusted workspace. `getModelRuntime()` is a
 * process-wide singleton, so a provider registered from one workspace would be visible to every
 * later session in that process, including untrusted ones. A provider config carries a `baseUrl` and
 * an `apiKey`, so that would let one workspace route another workspace's prompts to its own
 * endpoint. Global extensions do not have that problem: they are the same for every workspace, which
 * is exactly why the shipped path loads them regardless of trust (`sidecarContext.ts`).
 *
 * ## Failures are diagnostics, never a thrown error
 *
 * A broken extension must not stop a session from opening, and one bad provider must not cost the
 * user the others. The loader's own failure is a warning for the same reason `customizations.ts`
 * treats it as one: package resolution needs `npm`, which a GUI launch may not have on PATH.
 */
export async function registerExtensionProviders(
  roots: ExtensionProviderRoots
): Promise<CustomizationDiagnostic[]> {
  const diagnostics: CustomizationDiagnostic[] = []
  // Without this the loader treats `agentDir` itself as an extension to import (its package-root
  // fallback) and every start reports "Cannot find module <agentDir>" for a user who has simply
  // never installed an extension.
  if (!existsSync(join(roots.agentDir, 'extensions'))) return diagnostics
  const cwd = roots.cwd ?? roots.agentDir
  const settingsManager = SettingsManager.create(cwd, roots.agentDir)
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: roots.agentDir,
    settingsManager,
    // Project-local extensions stay out; the global dir is added back explicitly. This is the same
    // arrangement the shipped path uses for an untrusted workspace, and it is the only arrangement
    // that is safe with a shared model runtime.
    noExtensions: true,
    additionalExtensionPaths: [roots.agentDir],
  })

  try {
    await loader.reload()
  } catch (error) {
    diagnostics.push({
      type: 'warning',
      message: `Extension loading failed (npm may not be in PATH): ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  }

  // Extension load failures do NOT reject `reload()` and are NOT in `getExtensions().diagnostics`
  // (that field does not exist on this result) — the loader collects them in `errors`, one entry per
  // extension, whether the module failed to import or its factory threw.
  const loaded = loader.getExtensions()
  for (const { path, error } of loaded.errors) {
    diagnostics.push({ type: 'error', message: error, path })
  }

  const pending = loaded.runtime.pendingProviderRegistrations
  for (const { name, config, extensionPath } of pending) {
    try {
      roots.models.registerProvider(name, config)
    } catch (error) {
      diagnostics.push({
        type: 'error',
        message: `Extension "${extensionPath}" could not register provider "${name}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        path: extensionPath,
      })
    }
  }
  // The queue is not drained like the SDK does: every call here builds its own loader, so the queue
  // cannot outlive the call. Draining looked defensive but nothing could observe it, and a test that
  // cannot fail is worse than no test.

  return diagnostics
}
