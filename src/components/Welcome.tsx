import logoUrl from '@icons/icon.svg'
import { ExternalLink, FolderOpen } from 'lucide-solid'
import { createEffect, createSignal, Show } from 'solid-js'

type WelcomeProps = {
  appName: string
  appVersionLabel: string | null
  error: string | null
  onOpen: () => void
}

export function Welcome(props: WelcomeProps) {
  const [firstRun, setFirstRun] = createSignal(false)

  createEffect(() => {
    void window.openpi.getFirstRun().then((isFirst) => setFirstRun(isFirst))
  })

  return (
    <div class="welcome-screen">
      <div class="welcome-logo-stage">
        <img class="welcome-logo" src={logoUrl} alt="OpenPi" />
        <span class="welcome-logo-scan" aria-hidden="true" />
      </div>
      <div class="eyebrow">{props.appName}</div>
      <h1>A desktop workbench for Pi coding agent</h1>
      <p>Local-first sessions, model controls, and recoverable agent state.</p>

      <Show when={firstRun()}>
        <div class="welcome-onboarding">
          <p class="welcome-onboarding-intro">
            <strong>Getting started:</strong> Open a workspace directory to start a Pi session. Pi
            reads your project files, responds to prompts, and edits code — all with full context of
            your repository.
          </p>
          <div class="welcome-onboarding-steps">
            <div class="welcome-step">
              <span class="welcome-step-num">1</span>
              <span>
                Click <strong>Open workspace</strong> and select your project folder
              </span>
            </div>
            <div class="welcome-step">
              <span class="welcome-step-num">2</span>
              <span>
                Type <kbd>/goal</kbd> to set an objective, or just start chatting
              </span>
            </div>
            <div class="welcome-step">
              <span class="welcome-step-num">3</span>
              <span>Review changes in the Git panel, then stage and commit</span>
            </div>
          </div>
          <div class="welcome-onboarding-links">
            <a
              href="https://github.com/earendil-works/pi"
              target="_blank"
              rel="noopener noreferrer"
              class="welcome-link"
            >
              <ExternalLink size={13} /> Pi repo
            </a>
            <a
              href="https://github.com/huynhgiabuu/openpi"
              target="_blank"
              rel="noopener noreferrer"
              class="welcome-link"
            >
              <ExternalLink size={13} /> OpenPi source
            </a>
          </div>
        </div>
      </Show>

      <div class="welcome-actions">
        <button type="button" class="button-primary" onClick={props.onOpen}>
          <FolderOpen size={15} /> Open workspace
        </button>
      </div>

      <Show when={props.error}>
        <div class="error-banner">{props.error}</div>
      </Show>
      <Show when={props.appVersionLabel}>
        {(versionLabel) => <span class="welcome-version">{versionLabel()}</span>}
      </Show>
    </div>
  )
}
