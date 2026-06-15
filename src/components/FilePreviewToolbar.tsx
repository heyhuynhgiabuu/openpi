import { Code2, FileText, Keyboard, PanelRight, Save, Search, X } from 'lucide-solid'
import { Show } from 'solid-js'
import { isMacPlatform } from '../lib/shortcutFormat'
import { EDITOR_THEMES, type EditorThemeId, isEditorThemeId } from './CodeMirrorEditor'
import type { ViewMode } from './FilePreviewBody'

export interface FilePreviewToolbarProps {
  truncated: boolean
  isImage: boolean
  isMarkdown: boolean
  isDirty: boolean
  saveStatus: 'idle' | 'saved' | 'error'
  formatOnSave: boolean
  editorTheme: EditorThemeId
  vimMode: boolean
  mode: ViewMode
  saving: boolean
  truncatedFile: boolean
  content: string | null
  loading: boolean
  onFormatOnSaveToggle: () => void
  onEditorThemeChange: (theme: EditorThemeId) => void
  onVimModeToggle: () => void
  onOpenFind: () => void
  onSave: () => void
  onToggleSplit: () => void
  onToggleMode: () => void
  onClose: () => void
}

export function FilePreviewToolbar(props: FilePreviewToolbarProps) {
  return (
    <div class="fv-topbar">
      <div class="fv-topbar-identity">
        <Show when={props.truncated}>
          <span class="fv-topbar-badge">Truncated</span>
        </Show>
        <Show when={!props.truncated}>
          <Show when={props.isDirty}>
            <span class="fv-topbar-badge fv-topbar-badge--dirty">Unsaved</span>
          </Show>
          <Show when={props.saveStatus === 'saved'}>
            <span class="fv-topbar-badge">Saved</span>
          </Show>
        </Show>
        <Show when={props.saveStatus === 'error'}>
          <span class="fv-topbar-badge fv-topbar-badge--error">Error saving</span>
        </Show>
      </div>

      <div class="fv-topbar-actions">
        <Show when={!props.isImage}>
          <button
            type="button"
            class={`fv-tb-btn${props.formatOnSave ? ' fv-tb-btn--active' : ''}`}
            title={
              props.formatOnSave
                ? `Format on save enabled (${isMacPlatform() ? '⌘⇧F' : 'Ctrl+Shift+F'} to format now)`
                : 'Format on save disabled'
            }
            onClick={() => props.onFormatOnSaveToggle()}
          >
            <Code2 size={14} strokeWidth={1.8} />
          </button>
        </Show>

        <Show when={!props.isImage}>
          <button
            type="button"
            class={`fv-tb-btn${props.vimMode ? ' fv-tb-btn--active' : ''}`}
            title={props.vimMode ? 'Disable Vim mode' : 'Enable Vim mode'}
            aria-pressed={props.vimMode}
            onClick={() => props.onVimModeToggle()}
          >
            <Keyboard size={14} strokeWidth={1.8} />
          </button>
        </Show>

        <Show when={!props.isImage}>
          <button
            type="button"
            class="fv-tb-btn"
            title={`Find (${isMacPlatform() ? '⌘F' : 'Ctrl+F'})`}
            onClick={() => props.onOpenFind()}
          >
            <Search size={14} strokeWidth={1.8} />
          </button>
        </Show>

        <Show when={!props.isImage}>
          <label class="fv-theme-select" title="Editor theme">
            <span class="fv-theme-select-label">Theme</span>
            <select
              value={props.editorTheme}
              onChange={(event) => {
                const nextTheme = event.currentTarget.value
                if (isEditorThemeId(nextTheme)) props.onEditorThemeChange(nextTheme)
              }}
            >
              {EDITOR_THEMES.map((theme) => (
                <option value={theme.id}>{theme.label}</option>
              ))}
            </select>
          </label>
        </Show>

        <Show when={!props.isImage}>
          <span class="fv-tb-divider" />
        </Show>

        <Show when={!props.isImage}>
          <button
            type="button"
            class={`fv-tb-btn${props.isDirty ? ' fv-tb-btn--dirty' : ''}`}
            title={
              props.truncatedFile
                ? 'Cannot save truncated file'
                : `Save (${isMacPlatform() ? '⌘S' : 'Ctrl+S'})`
            }
            onClick={() => void props.onSave()}
            disabled={!props.isDirty || props.saving || props.truncatedFile}
          >
            <Save size={14} strokeWidth={1.8} />
          </button>
        </Show>

        <Show when={props.isMarkdown}>
          <button
            type="button"
            class={`fv-tb-btn${props.mode === 'split' ? ' fv-tb-btn--active' : ''}`}
            title={props.mode === 'split' ? 'Close side preview' : 'Open preview to the side'}
            onClick={props.onToggleSplit}
            disabled={!props.isImage && props.content === null && !props.loading}
          >
            <PanelRight size={14} strokeWidth={1.8} />
          </button>
        </Show>

        <Show when={props.isMarkdown && props.mode !== 'split'}>
          <button
            type="button"
            class={`fv-tb-btn${props.mode === 'preview' ? ' fv-tb-btn--active' : ''}`}
            title={props.mode === 'preview' ? 'Reopen as editable text' : 'Open preview'}
            onClick={props.onToggleMode}
          >
            <Show
              when={props.mode === 'preview'}
              fallback={<FileText size={14} strokeWidth={1.8} />}
            >
              <Code2 size={14} strokeWidth={1.8} />
            </Show>
          </button>
        </Show>

        <span class="fv-tb-divider" />

        <button
          type="button"
          class="fv-tb-btn fv-tb-btn--close"
          title="Close (Esc)"
          onClick={props.onClose}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
