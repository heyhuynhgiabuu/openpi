import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { Provider } from '@earendil-works/pi-ai'
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
  /** The other registerProvider form: a whole `Provider` object rather than a config. */
  registerNativeProvider(provider: Provider): void
}

export interface ExtensionProviderRoots {
  /** The global Pi agent dir; its `extensions/` is the user's own code. */
  agentDir: string
  /**
   * Workspace whose `.pi/extensions` and `.pi/settings.json` must NOT be loaded. Only used to give
   * the loader a cwd; `projectTrusted: false` is what keeps the workspace's own extensions out.
   */
  cwd?: string
  models: ProviderRegistrar
}

/**
 * Load the user's global Pi extensions and register the model providers they declare.
 *
 * The durable runtime loads no extensions (`customizations.ts` sets `noExtensions`), so a user whose
 * only model comes from an extension — `copilot-provider.ts` registering `github-copilot` is the
 * example the shipped path names — starts a session here and is told "no model has credentials".
 * This closes that: register the providers before the model is chosen.
 *
 * Covered: `~/.pi/agent/extensions`, and the global `settings.json`'s `extensions` and installed
 * packages, which is how a `pi install`ed provider actually ships. Both `registerProvider` forms are
 * drained. Virtual models are refused with a warning instead (see below).
 *
 * ## Why the workspace's own extensions are excluded
 *
 * `getModelRuntime()` is a process-wide singleton, so a provider registered from one workspace stays
 * visible to every later session in that process. A provider config carries a `baseUrl` and an
 * `apiKey`, so that would let one workspace route another workspace's prompts to its own endpoint,
 * and keep doing it after the user switches away. Global extensions are the same code for every
 * workspace, so they cannot carry that risk.
 *
 * This is a narrowing, not a boundary: the SDK path already loads a trusted workspace's extensions
 * into that same shared runtime, so a trusted workspace can influence later sessions today. Closing
 * that is a separate change on the SDK path; this module simply does not extend it to a runtime
 * nobody is watching.
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
  // `projectTrusted: false` is what excludes `<cwd>/.pi/extensions` and the workspace's own
  // settings, without also excluding the user's global ones. `noExtensions: true` could not express
  // that: it drops global `settings.json` extensions and `pi install`ed packages too, which is how
  // most extension providers actually ship.
  const settingsManager = SettingsManager.create(cwd, roots.agentDir, { projectTrusted: false })
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: roots.agentDir,
    settingsManager,
    noExtensions: false,
  })

  try {
    await loader.reload()
  } catch (error) {
    diagnostics.push({
      type: 'warning',
      message: `Extension loading failed (npm may not be in PATH): ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  // Extension load failures do NOT reject `reload()` and are NOT in `getExtensions().diagnostics`
  // (that field does not exist on this result) — the loader collects them in `errors`, one entry per
  // extension, whether the module failed to import or its factory threw.
  const loaded = loader.getExtensions()
  // Same shape the shipped path prints, so an extension failure reads the same on both runtimes.
  for (const { path, error } of loaded.errors) {
    diagnostics.push({ type: 'error', message: `[extension] ${path} (load): ${error}`, path })
  }

  for (const { name, config, extensionPath } of loaded.runtime.pendingProviderRegistrations) {
    try {
      roots.models.registerProvider(name, config)
    } catch (error) {
      diagnostics.push({
        type: 'error',
        message: `[extension] ${extensionPath} (register_provider): ${error instanceof Error ? error.message : String(error)}`,
        path: extensionPath,
      })
    }
  }

  // The other `registerProvider` form takes a whole `Provider`, and arrives in its own queue.
  for (const { provider, extensionPath } of loaded.runtime.pendingNativeProviderRegistrations) {
    try {
      roots.models.registerNativeProvider(provider)
    } catch (error) {
      diagnostics.push({
        type: 'error',
        message: `[extension] ${extensionPath} (register_provider): ${error instanceof Error ? error.message : String(error)}`,
        path: extensionPath,
      })
    }
  }

  // Virtual models are NOT registered: their `route` is handed a runtime context that only a bound
  // runner provides, and this path never binds one — a registered virtual model would look fine and
  // then throw on its first request. Reported so the extension is not silently half-applied.
  for (const { definition, extensionPath } of loaded.runtime.pendingVirtualModelRegistrations) {
    diagnostics.push({
      type: 'warning',
      message: `[extension] ${extensionPath} (register_virtual_model): virtual models are not supported by the durable runtime (id "${definition.id}")`,
      path: extensionPath,
    })
  }
  // The queue is not drained like the SDK does: every call here builds its own loader, so the queue
  // cannot outlive the call. Draining looked defensive but nothing could observe it, and a test that
  // cannot fail is worse than no test.

  return diagnostics
}
