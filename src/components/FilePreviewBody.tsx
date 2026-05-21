import type { EditorView } from '@codemirror/view'
import { X } from 'lucide-solid'
import { Show } from 'solid-js'
import { FileIcon } from '../lib/fileIcons'
import { CodeMirrorEditor, type EditorThemeId } from './CodeMirrorEditor'
import { MarkdownContent } from './conversation/MarkdownContent'
import { SyntaxPreview } from './FilePreviewPane'

export type ViewMode = 'edit' | 'preview' | 'split'

export { SyntaxPreview }

export interface FilePreviewBodyProps {
  saveError: string | null
  isImage: boolean
  imgSrc: string
  filename: string
  loading: boolean
  content: string | null
  mode: ViewMode
  editBuffer: string
  isMarkdown: boolean
  wordWrap: boolean
  vimMode: boolean
  editorTheme: EditorThemeId
  findOpen: boolean
  findQuery: string
  findCaseSensitive: boolean
  findWholeWord: boolean
  findRegex: boolean
  safeMatchIndex: number
  previewScrollRef: HTMLDivElement | undefined
  onEditBufferChange: (v: string) => void
  onSetMode: (mode: ViewMode) => void
  onSyncEditorToPreview: () => void
  onSyncPreviewToEditor: () => void
  onOpenFindBar: (withReplace?: boolean) => void
  onEditorViewInit: (view: EditorView) => void
}

export function FilePreviewBody(props: FilePreviewBodyProps) {
  return (
    <div class="fv-body">
      <Show when={props.saveError}>
        <div class="fv-state-msg fv-state-msg--error">{props.saveError}</div>
      </Show>

      <Show when={props.isImage}>
        <div class="fv-image-body">
          <img src={props.imgSrc} alt={props.filename} class="fv-image" />
        </div>
      </Show>

      <Show when={!props.isImage && props.loading}>
        <div class="fv-state-msg">Loading…</div>
      </Show>

      <Show when={!props.isImage && !props.loading && props.content === null}>
        <div class="fv-state-msg fv-state-msg--error">
          Could not read file — it may be binary or outside the workspace.
        </div>
      </Show>

      <Show
        when={!props.isImage && !props.loading && props.content !== null && props.mode === 'edit'}
      >
        <CodeMirrorEditor
          value={props.editBuffer}
          filename={props.filename}
          onChange={props.onEditBufferChange}
          onViewInit={props.onEditorViewInit}
          onExtraScroll={props.onSyncEditorToPreview}
          onFindRequest={() => props.onOpenFindBar()}
          onReplaceRequest={() => props.onOpenFindBar(true)}
          wordWrap={props.wordWrap}
          vimMode={props.vimMode}
          editorTheme={props.editorTheme}
          searchQuery={props.findOpen ? props.findQuery : ''}
          searchCaseSensitive={props.findCaseSensitive}
          searchWholeWord={props.findWholeWord}
          searchRegex={props.findRegex}
          searchCurrentIndex={props.safeMatchIndex}
        />
      </Show>

      <Show
        when={
          !props.isImage && !props.loading && props.content !== null && props.mode === 'preview'
        }
      >
        <Show
          when={props.isMarkdown}
          fallback={<SyntaxPreview name={props.filename} contents={props.editBuffer} />}
        >
          <div class="fv-md-preview">
            <MarkdownContent text={props.editBuffer} />
          </div>
        </Show>
      </Show>

      <Show
        when={!props.isImage && !props.loading && props.content !== null && props.mode === 'split'}
      >
        <div class="fv-split-wrap">
          <div class="fv-split-editor">
            <CodeMirrorEditor
              value={props.editBuffer}
              filename={props.filename}
              onChange={props.onEditBufferChange}
              onViewInit={props.onEditorViewInit}
              onExtraScroll={props.onSyncEditorToPreview}
              onFindRequest={() => props.onOpenFindBar()}
              onReplaceRequest={() => props.onOpenFindBar(true)}
              wordWrap={props.wordWrap}
              vimMode={props.vimMode}
              editorTheme={props.editorTheme}
              searchQuery={props.findOpen ? props.findQuery : ''}
              searchCaseSensitive={props.findCaseSensitive}
              searchWholeWord={props.findWholeWord}
              searchRegex={props.findRegex}
              searchCurrentIndex={props.safeMatchIndex}
            />
          </div>

          <div class="fv-split-divider" />

          <div class="fv-split-preview">
            <div class="fv-split-preview-header">
              <FileIcon name={props.filename} size={13} />
              <span class="fv-split-preview-title">Preview {props.filename}</span>
              <button
                type="button"
                class="fv-tb-btn"
                title="Close preview"
                onClick={() => props.onSetMode('edit')}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>

            <div
              ref={props.previewScrollRef}
              class="fv-split-preview-content"
              onScroll={props.onSyncPreviewToEditor}
            >
              <Show
                when={props.isMarkdown}
                fallback={<SyntaxPreview name={props.filename} contents={props.editBuffer} />}
              >
                <div class="fv-md-preview">
                  <MarkdownContent text={props.editBuffer} />
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
