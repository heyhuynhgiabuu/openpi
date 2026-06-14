/**
 * FileTree — workspace file browser for the Git panel "Files" tab.
 *
 * Tree structure: Zed-style connector rails and elbows instead of text glyphs.
 * Folder open/closed state is shown by the folder icon itself.
 * File icons are provided by fileIcons.tsx.
 *
 * Renderer is read-only: displays the file tree and emits file-click events.
 * Actual I/O lives in Electron main (getFileTree IPC).
 */

import { ContextMenu as KContextMenu } from '@kobalte/core/context-menu'
import { MoreHorizontal } from 'lucide-solid'
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { FileIcon, FolderIcon } from '../../lib/fileIcons'
import type { FileTreeNode, FileTreeResult } from '../../lib/ipc'

interface FileTreeProps {
  cwd: string | null
  changedPaths?: Set<string>
  onFileClick?: (relPath: string) => void
  onFileDeleted?: (relPath: string, isDir: boolean) => void
  onFileRenamed?: (oldPath: string, newPath: string) => void
  triggerCollapseAll?: number
}

interface NodeProps {
  node: FileTreeNode
  isLast: boolean
  parentLines: boolean[]
  changedPaths: Set<string>
  expanded: Set<string>
  onToggle: (path: string) => void
  onFileClick?: (relPath: string) => void
  onDelete?: (node: FileTreeNode) => void
  onRename?: (node: FileTreeNode) => void
  onCopy?: (node: FileTreeNode) => void
  onContextMenu?: (e: MouseEvent, node: FileTreeNode) => void
  renamingPath: () => string | null
  renamingDraft: () => string
  setRenamingDraft: (s: string) => void
  startRename: (node: FileTreeNode) => void
  commitRename: () => void
  cancelRename: () => void
  onRenameKeyDown?: (e: KeyboardEvent) => void
  onRenameInputRef?: (el: HTMLInputElement | null) => void
  activeNodePath: () => string | null
  setActiveNodePath: (path: string | null) => void
}

function NodeName(props: NodeProps, isChanged: () => boolean) {
  if (props.renamingPath() === props.node.path) {
    return (
      <input
        ref={props.onRenameInputRef}
        class="ftree-rename-input"
        value={props.renamingDraft()}
        onInput={(e) => props.setRenamingDraft((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={props.onRenameKeyDown}
        onBlur={props.commitRename}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
      />
    )
  }
  return (
    <span
      class={`ftree-name${isChanged() ? ' is-changed' : ''}`}
      onDblClick={(e) => {
        e.stopPropagation()
        props.startRename(props.node)
      }}
    >
      {props.node.name}
    </span>
  )
}

function TreeNode(props: NodeProps) {
  const isExpanded = () => props.expanded.has(props.node.path)
  const isChanged = () => props.changedPaths.has(props.node.path)

  return (
    <Show
      when={props.node.isDir}
      fallback={
        <KContextMenu>
          <div
            class="ftree-item"
            style={{ '--indent': `${(props.parentLines.length + 1) * 16}px` }}
          >
            <KContextMenu.Trigger
              as="button"
              type="button"
              class="ftree-row ftree-file"
              title={props.node.path}
              onClick={() => {
                props.setActiveNodePath(props.node.path)
                props.onFileClick?.(props.node.path)
              }}
            >
              <FileIcon name={props.node.name} size={15} />
              {NodeName(props, isChanged)}
            </KContextMenu.Trigger>
            <button
              type="button"
              class="ftree-more-btn"
              title="More actions"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={13} strokeWidth={1.8} />
            </button>
          </div>
          <KContextMenu.Portal>
            <KContextMenu.Content class="ftree-context-menu">
              <KContextMenu.Item
                class="ftree-context-menu__item"
                onSelect={() => props.startRename?.(props.node)}
              >
                Rename
                <span class="ftree-context-menu__shortcut">F2</span>
              </KContextMenu.Item>
              <KContextMenu.Item
                class="ftree-context-menu__item"
                onSelect={() => props.onCopy?.(props.node)}
              >
                Copy
                <span class="ftree-context-menu__shortcut">Ctrl/Cmd+C</span>
              </KContextMenu.Item>
              <KContextMenu.Separator class="ftree-context-menu__separator" />
              <KContextMenu.Item
                class="ftree-context-menu__item ftree-context-menu__item--danger"
                onSelect={() => props.onDelete?.(props.node)}
              >
                Move to Trash
                <span class="ftree-context-menu__shortcut">Del</span>
              </KContextMenu.Item>
            </KContextMenu.Content>
          </KContextMenu.Portal>
        </KContextMenu>
      }
    >
      <KContextMenu>
        <div class="ftree-item" style={{ '--indent': `${(props.parentLines.length + 1) * 16}px` }}>
          <KContextMenu.Trigger
            as="button"
            type="button"
            class="ftree-row ftree-dir"
            onClick={() => {
              props.setActiveNodePath(props.node.path)
              props.onToggle(props.node.path)
            }}
            title={props.node.path}
          >
            <Show when={(props.node.children?.length ?? 0) > 0}>
              <span class={`ftree-chevron${isExpanded() ? ' is-expanded' : ''}`} aria-hidden="true">
                ▸
              </span>
            </Show>
            <Show when={isExpanded()}>
              <FolderIcon name={props.node.name} size={15} open={true} />
            </Show>
            <span class={`ftree-name${isChanged() ? ' is-changed' : ''}`}>{props.node.name}</span>
          </KContextMenu.Trigger>
          <button
            type="button"
            class="ftree-more-btn"
            title="More actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={13} strokeWidth={1.8} />
          </button>
        </div>
        <KContextMenu.Portal>
          <KContextMenu.Content class="ftree-context-menu">
            <KContextMenu.Item
              class="ftree-context-menu__item"
              onSelect={() => props.startRename?.(props.node)}
            >
              Rename
              <span class="ftree-context-menu__shortcut">F2</span>
            </KContextMenu.Item>
            <KContextMenu.Item
              class="ftree-context-menu__item"
              onSelect={() => props.onCopy?.(props.node)}
            >
              Copy
              <span class="ftree-context-menu__shortcut">Ctrl/Cmd+C</span>
            </KContextMenu.Item>
            <KContextMenu.Separator class="ftree-context-menu__separator" />
            <KContextMenu.Item
              class="ftree-context-menu__item ftree-context-menu__item--danger"
              onSelect={() => props.onDelete?.(props.node)}
            >
              Move to Trash
              <span class="ftree-context-menu__shortcut">Del</span>
            </KContextMenu.Item>
          </KContextMenu.Content>
        </KContextMenu.Portal>
      </KContextMenu>
      <Show when={isExpanded()}>
        <For each={props.node.children ?? []}>
          {(child, idx) => {
            const childParentLines = [...props.parentLines, !props.isLast]
            const isLastChild = idx() === (props.node.children?.length ?? 0) - 1
            return (
              <TreeNode
                node={child}
                isLast={isLastChild}
                parentLines={childParentLines}
                changedPaths={props.changedPaths}
                expanded={props.expanded}
                onToggle={props.onToggle}
                onFileClick={props.onFileClick}
                onDelete={props.onDelete}
                onRename={props.onRename}
                onCopy={props.onCopy}
                onContextMenu={props.onContextMenu}
                renamingPath={props.renamingPath}
                renamingDraft={props.renamingDraft}
                setRenamingDraft={props.setRenamingDraft}
                startRename={props.startRename}
                commitRename={props.commitRename}
                cancelRename={props.cancelRename}
                onRenameKeyDown={props.onRenameKeyDown}
                onRenameInputRef={props.onRenameInputRef}
                activeNodePath={props.activeNodePath}
                setActiveNodePath={props.setActiveNodePath}
              />
            )
          }}
        </For>
      </Show>
    </Show>
  )
}

export function FileTree(props: FileTreeProps) {
  const [tree, setTree] = createSignal<FileTreeResult | null>(null)
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null)
  const [renamingDraft, setRenamingDraft] = createSignal<string>('')
  const [activeNodePath, setActiveNodePath] = createSignal<string | null>(null)
  let mounted = true
  let requestId = 0

  const startRename = (node: FileTreeNode) => {
    setRenamingPath(node.path)
    setRenamingDraft(node.name)
  }
  const cancelRename = () => {
    setRenamingPath(null)
    setRenamingDraft('')
  }
  const commitRename = async () => {
    const path = renamingPath()
    const draft = renamingDraft().trim()
    cancelRename()
    if (!path) return
    const original = path.split('/').pop() ?? ''
    if (!draft || draft === original) return
    try {
      const newPath = await window.openpi.renameFile(path, draft)
      props.onFileRenamed?.(path, newPath)
      void refreshTree(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not rename')
    }
  }
  const onRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
  }

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
  const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    return false
  }
  const getActiveNode = (): FileTreeNode | null => {
    const path = activeNodePath()
    if (!path) return null
    const findInTree = (n: FileTreeNode): FileTreeNode | null => {
      if (n.path === path) return n
      for (const child of n.children ?? []) {
        const r = findInTree(child)
        if (r) return r
      }
      return null
    }
    const root = tree()
    if (!root) return null
    for (const child of root.children) {
      const r = findInTree(child)
      if (r) return r
    }
    return null
  }
  const handleTreeKeydown = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return
    const node = getActiveNode()
    if (!node) return
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
    if (e.key === 'F2' && !e.shiftKey && !cmdOrCtrl && !e.altKey) {
      e.preventDefault()
      startRename(node)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!e.shiftKey && !cmdOrCtrl && !e.altKey) {
        e.preventDefault()
        void deleteNode(node)
      }
    } else if ((e.key === 'c' || e.key === 'C') && cmdOrCtrl && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void copyNode(node)
    }
  }
  onMount(() => {
    window.addEventListener('keydown', handleTreeKeydown)
  })
  onCleanup(() => {
    window.removeEventListener('keydown', handleTreeKeydown)
  })

  const refreshTree = async (resetExpansion = false) => {
    const currentRequest = ++requestId
    const result = await window.openpi.git.getFileTree()
    if (!mounted || currentRequest !== requestId) return
    setTree(result)
    if (result && resetExpansion) setExpanded(new Set(['']))
  }

  onMount(() => {
    mounted = true
    onCleanup(() => {
      mounted = false
    })
  })

  createEffect(() => {
    const trigger = props.triggerCollapseAll
    if (trigger !== undefined && trigger > 0) {
      void Promise.resolve().then(() => setExpanded(new Set([''])))
    }
  })

  createEffect(() => {
    const cwd = props.cwd
    if (!cwd) {
      setTree(null)
      requestId += 1
      return
    }

    void refreshTree(true)
    const unsubscribe = window.openpi.git.onFileTreeChanged(() => {
      void refreshTree(false)
    })
    onCleanup(unsubscribe)
  })

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const deleteNode = async (node: FileTreeNode) => {
    try {
      const result = await window.openpi.deleteFile(node.path)
      if (!result.trashed) return
      props.onFileDeleted?.(node.path, node.isDir)
      void refreshTree(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not move item to Trash')
    }
  }

  const copyNode = async (node: FileTreeNode) => {
    try {
      await window.openpi.copyFile(node.path)
      void refreshTree(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not copy')
    }
  }

  const handleContextMenu = (_event: MouseEvent, _node: FileTreeNode) => {
    // Kobalte <ContextMenu.Trigger> in the row handles the right-click
    // and shows the actual menu; this no-op is left as a prop so callers
    // can still wire their own logic if they want to.
  }

  const changedPaths = () => props.changedPaths ?? new Set<string>()
  const isRootExpanded = () => expanded().has('')

  return (
    <Show
      when={tree()}
      fallback={<div class="ftree-empty">{props.cwd ? 'Loading…' : 'No workspace'}</div>}
    >
      {(resolvedTree) => (
        <div class="ftree-root">
          <button
            type="button"
            class="ftree-row ftree-dir ftree-workspace-root"
            onClick={() => toggle('')}
          >
            <span class="ftree-root-chevron">{isRootExpanded() ? '▾' : '▸'}</span>
            <FolderIcon name={resolvedTree().rootName} size={15} open={isRootExpanded()} />
            <span class="ftree-name">{resolvedTree().rootName}</span>
          </button>

          <Show when={isRootExpanded()}>
            <For each={resolvedTree().children}>
              {(child, idx) => (
                <TreeNode
                  node={child}
                  isLast={idx() === resolvedTree().children.length - 1}
                  parentLines={[]}
                  changedPaths={changedPaths()}
                  expanded={expanded()}
                  onToggle={toggle}
                  onFileClick={props.onFileClick}
                  onDelete={deleteNode}
                  onRename={startRename}
                  onCopy={copyNode}
                  onContextMenu={handleContextMenu}
                  renamingPath={renamingPath}
                  renamingDraft={renamingDraft}
                  setRenamingDraft={setRenamingDraft}
                  startRename={startRename}
                  commitRename={commitRename}
                  cancelRename={cancelRename}
                  onRenameKeyDown={onRenameKeyDown}
                  onRenameInputRef={(el) => {
                    if (el) {
                      el.focus()
                      el.select()
                    }
                  }}
                  activeNodePath={activeNodePath}
                  setActiveNodePath={setActiveNodePath}
                />
              )}
            </For>
          </Show>
        </div>
      )}
    </Show>
  )
}
