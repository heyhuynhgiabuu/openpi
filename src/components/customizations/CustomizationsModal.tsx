import { Dialog } from '@kobalte/core'
import {
  Blocks,
  FileText,
  Keyboard,
  Package,
  Palette,
  SlidersHorizontal,
  ToggleLeft,
  WandSparkles,
  Wrench,
  X,
} from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type {
  CustomizationsInventory,
  CustomizationType,
  ModelInfo,
  SessionReady,
} from '../../lib/ipc'
import { ChangelogModal } from '../ChangelogModal'
import { Badge } from '../common/Badge'
import { ExtensionsPane } from './ExtensionsPane'
import { GeneralPane } from './GeneralPane'
import { KeybindingsPane } from './KeybindingsPane'
import { PackagesPane } from './PackagesPane'
import { PromptsPane } from './PromptsPane'
import { SettingsPane } from './SettingsPane'
import { SkillsPane } from './SkillsPane'
import { ThemesPane } from './ThemesPane'

type CustomizationsModalProps = {
  open: boolean
  appName: string
  appVersionLabel: string | null
  models: ModelInfo[]
  currentModel: SessionReady['model']
  onSelectModel: (model: ModelInfo) => void
  onClose: () => void
  onError: (message: string) => void
  cwd: string | null
}

type ActiveTab = CustomizationType | 'settings' | 'general' | 'keybindings'

type NavItem = {
  type: ActiveTab
  label: string
  icon: typeof Wrench
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Resources',
    items: [
      { type: 'extensions', label: 'Extensions', icon: Wrench },
      { type: 'skills', label: 'Skills', icon: Blocks },
      { type: 'prompts', label: 'Prompts', icon: WandSparkles },
      { type: 'themes', label: 'Themes', icon: Palette },
      { type: 'packages', label: 'Packages', icon: Package },
    ],
  },
  {
    label: 'Pi',
    items: [{ type: 'settings', label: 'Settings', icon: SlidersHorizontal }],
  },
  {
    label: 'Desktop',
    items: [
      { type: 'general', label: 'General', icon: ToggleLeft },
      { type: 'keybindings', label: 'Keybindings', icon: Keyboard },
    ],
  },
]

const VISUALLY_HIDDEN_STYLE = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  'white-space': 'nowrap',
  border: '0',
} as const

export function CustomizationsModal(props: CustomizationsModalProps) {
  const [inventory, setInventory] = createSignal<CustomizationsInventory | null>(null)
  const [activeType, setActiveType] = createSignal<ActiveTab>('extensions')
  const [loading, setLoading] = createSignal(false)
  const [changelogOpen, setChangelogOpen] = createSignal(false)

  let contentEl: HTMLElement | undefined

  const loadInventory = async () => {
    setLoading(true)
    try {
      setInventory(await window.openpi.getCustomizations())
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    if (!props.open) return
    const timer = window.setTimeout(() => {
      void loadInventory()
    }, 0)
    return () => window.clearTimeout(timer)
  })

  // Reset scroll position when switching tabs so previous tab's scroll
  // offset does not carry over into the new tab.
  createEffect(() => {
    const tab = activeType()
    if (!props.open) return
    queueMicrotask(() => {
      if (activeType() !== tab) return
      contentEl?.scrollTo({ top: 0, left: 0 })
    })
  })

  const counts = createMemo(() => {
    const next: Record<CustomizationType, number> = {
      extensions: 0,
      skills: 0,
      prompts: 0,
      themes: 0,
      packages: 0,
    }
    for (const item of inventory()?.items ?? []) next[item.type] += 1
    return next
  })

  const activeItems = createMemo(() => {
    if (activeType() === 'settings' || activeType() === 'general' || activeType() === 'keybindings')
      return []
    return (inventory()?.items ?? []).filter((item) => item.type === activeType())
  })

  const projectExtensionCount = createMemo(() => {
    return (inventory()?.items ?? []).filter(
      (item) => item.type === 'extensions' && item.scope === 'project'
    ).length
  })

  const themeItems = createMemo(() =>
    (inventory()?.items ?? []).filter((item) => item.type === 'themes')
  )

  const diagnostics = createMemo(() => inventory()?.diagnostics ?? [])

  const [pendingTrustConfirm, setPendingTrustConfirm] = createSignal(false)

  const trustWorkspace = async () => {
    if (!props.cwd) return
    // Show a confirmation dialog before enabling workspace trust so the user
    // sees all extensions that will become executable.
    const projectExts = (inventory()?.items ?? []).filter(
      (item) => item.type === 'extensions' && item.scope === 'project'
    )
    if (projectExts.length > 0 && !pendingTrustConfirm()) {
      setPendingTrustConfirm(true)
      return
    }
    setPendingTrustConfirm(false)
    try {
      await window.openpi.setWorkspaceTrust(props.cwd, true)
      await loadInventory()
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Dialog.Root open={props.open} onOpenChange={(isOpen) => !isOpen && props.onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay class="customizations-overlay" />
          <Dialog.Content
            class="customizations-modal"
            aria-describedby="customizations-description"
          >
            <Dialog.Title style={VISUALLY_HIDDEN_STYLE}>Customize OpenPi</Dialog.Title>
            <Dialog.Description id="customizations-description" style={VISUALLY_HIDDEN_STYLE}>
              Manage Pi resources and settings for this workspace.
            </Dialog.Description>

            <aside class="customizations-rail">
              <div class="customizations-rail-head">
                <div class="customizations-rail-head-top">
                  <div class="eyebrow">Customize</div>
                  <Dialog.CloseButton
                    class="icon-button customizations-rail-close"
                    aria-label="Close customizations"
                    title="Close"
                  >
                    <X size={16} />
                  </Dialog.CloseButton>
                </div>
              </div>

              <nav class="customizations-nav" aria-label="Customization sections">
                <For each={NAV_GROUPS}>
                  {(group) => (
                    <section class="customizations-nav-group">
                      <div class="customizations-nav-group-label">{group.label}</div>
                      <div class="customizations-nav-group-items">
                        <For each={group.items}>
                          {(item) => {
                            const Icon = item.icon
                            const count = () =>
                              item.type === 'settings' ||
                              item.type === 'general' ||
                              item.type === 'keybindings'
                                ? null
                                : counts()[item.type as CustomizationType]
                            const active = () => item.type === activeType()
                            return (
                              <button
                                type="button"
                                class={
                                  active() ? 'customizations-tab is-active' : 'customizations-tab'
                                }
                                onClick={() => setActiveType(item.type)}
                              >
                                <span class="customizations-tab-main">
                                  <Icon size={15} />
                                  <span>{item.label}</span>
                                </span>
                                <Show when={count() != null}>
                                  <Badge>{count() as number}</Badge>
                                </Show>
                              </button>
                            )
                          }}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
                <div class="customizations-rail-brand">
                  <div>
                    <span class="customizations-rail-brand-name">{props.appName}</span>
                    <Show when={props.appVersionLabel}>
                      {(versionLabel) => (
                        <span class="customizations-rail-brand-version">{versionLabel()}</span>
                      )}
                    </Show>
                  </div>
                  <button
                    type="button"
                    class="customizations-whats-new"
                    onClick={() => setChangelogOpen(true)}
                  >
                    <FileText size={13} />
                    What's New
                  </button>
                </div>
              </nav>
            </aside>

            <div class="customizations-main">
              <main
                ref={(element) => {
                  contentEl = element
                }}
                class="customizations-content"
              >
                <div class={`customizations-page-shell customizations-page-shell-${activeType()}`}>
                  <Show
                    when={
                      activeType() === 'extensions' &&
                      projectExtensionCount() > 0 &&
                      inventory()?.workspaceTrusted === false
                    }
                  >
                    <div class="trust-banner">
                      <Wrench size={16} />
                      <div>
                        <strong>Project-local extensions are discoverable but not trusted</strong>
                        <span>
                          {projectExtensionCount()} extension
                          {projectExtensionCount() === 1 ? '' : 's'} can execute arbitrary Node
                          code. OpenPi will not load workspace extensions until you explicitly trust
                          this workspace.
                        </span>
                      </div>
                      <Show
                        when={pendingTrustConfirm()}
                        fallback={
                          <button
                            type="button"
                            class="trust-banner-action"
                            onClick={() => void trustWorkspace()}
                          >
                            Trust workspace
                          </button>
                        }
                      >
                        <div class="trust-confirm-panel">
                          <p class="trust-confirm-warning">
                            ⚠ The following extensions will be granted full system permissions (file
                            system, network, shell). Review source before trusting.
                          </p>
                          <ul class="trust-confirm-list">
                            <For
                              each={(inventory()?.items ?? []).filter(
                                (item) => item.type === 'extensions' && item.scope === 'project'
                              )}
                            >
                              {(ext) => (
                                <li>
                                  <strong>{ext.name}</strong>
                                  <span class="trust-confirm-path">
                                    {ext.path?.replace(/^\/Users\/[^/]+\//, '~/')}
                                  </span>
                                </li>
                              )}
                            </For>
                          </ul>
                          <div class="trust-confirm-actions">
                            <button
                              type="button"
                              class="trust-banner-action trust-banner-action-danger"
                              onClick={() => void trustWorkspace()}
                            >
                              Confirm trust
                            </button>
                            <button
                              type="button"
                              class="trust-banner-action trust-banner-action-cancel"
                              onClick={() => setPendingTrustConfirm(false)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Show when={activeType() === 'settings'}>
                    <SettingsPane hasCwd={Boolean(props.cwd)} onError={props.onError} />
                  </Show>
                  <Show when={activeType() === 'general'}>
                    <GeneralPane onError={props.onError} themeItems={themeItems()} />
                  </Show>
                  <Show when={activeType() === 'keybindings'}>
                    <KeybindingsPane />
                  </Show>
                  <Show when={activeType() === 'packages'}>
                    <PackagesPane
                      items={activeItems()}
                      loading={loading()}
                      onReload={loadInventory}
                      onError={props.onError}
                    />
                  </Show>
                  <Show when={activeType() === 'themes'}>
                    <ThemesPane items={activeItems()} loading={loading()} />
                  </Show>
                  <Show when={activeType() === 'prompts'}>
                    <PromptsPane items={activeItems()} loading={loading()} />
                  </Show>
                  <Show when={activeType() === 'skills'}>
                    <SkillsPane items={activeItems()} loading={loading()} />
                  </Show>
                  <Show when={activeType() === 'extensions'}>
                    <ExtensionsPane
                      items={activeItems()}
                      loading={loading()}
                      workspaceTrusted={inventory()?.workspaceTrusted}
                      onTrustWorkspace={props.cwd ? () => void trustWorkspace() : undefined}
                      onToggleExtension={(id, enabled) => {
                        void window.openpi.setExtensionEnabled(id, enabled)
                      }}
                      onReload={() => {
                        void loadInventory()
                      }}
                    />
                  </Show>
                  <Show when={diagnostics().length > 0}>
                    <section class="diagnostics-panel">
                      <h3>Diagnostics</h3>
                      <div class="diagnostics-list">
                        <For each={diagnostics()}>
                          {(diagnostic) => (
                            <div class="diagnostic-row">
                              <Badge>{diagnostic.type}</Badge>
                              <span>{diagnostic.message}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  </Show>
                </div>
              </main>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ChangelogModal open={changelogOpen()} onClose={() => setChangelogOpen(false)} />
    </>
  )
}
