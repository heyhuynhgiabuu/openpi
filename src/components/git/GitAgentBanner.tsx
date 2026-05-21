import { For, Show } from 'solid-js'
import type { GitChangedFile } from '../../lib/ipc'
import {
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipRoot,
  TooltipTrigger,
} from '../ui/tooltip'

interface AgentChangedFiles {
  count: number
  files: GitChangedFile[]
}

interface GitAgentBannerProps {
  agentChangedFiles: AgentChangedFiles | null
  showingAgentFiles: boolean
  onReview: () => void
  onDismiss: () => void
}

export function GitAgentBanner(props: GitAgentBannerProps) {
  return (
    <Show when={props.agentChangedFiles}>
      {(agentFiles) => (
        <div class={`git-agent-banner${props.showingAgentFiles ? ' is-active' : ''}`}>
          <TooltipRoot openDelay={300} closeDelay={100}>
            <TooltipTrigger
              as="button"
              type="button"
              class="git-agent-banner-review"
              onClick={props.onReview}
            >
              ✨ Agent modified {agentFiles().count} file{agentFiles().count !== 1 ? 's' : ''}
              {props.showingAgentFiles ? ' (filtered)' : ' — click to review'}
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent class="git-tooltip-content">
                <div class="git-tooltip-header">Agent changed files</div>
                <For each={agentFiles().files.slice(0, 15)}>
                  {(file) => (
                    <div class="git-tooltip-file-row">
                      <span class={`git-tooltip-status git-tooltip-status--${file.status}`}>
                        {file.status}
                      </span>
                      <span class="git-tooltip-path">{file.path}</span>
                    </div>
                  )}
                </For>
                <Show when={agentFiles().files.length > 15}>
                  <div class="git-tooltip-file-row git-tooltip-overflow">
                    … and {agentFiles().files.length - 15} more
                  </div>
                </Show>
                <TooltipArrow size={6} />
              </TooltipContent>
            </TooltipPortal>
          </TooltipRoot>
          <button
            type="button"
            class="git-agent-banner-dismiss"
            onClick={props.onDismiss}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </Show>
  )
}
