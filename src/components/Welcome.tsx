import logoUrl from '@icons/icon.svg'
import { FolderOpen } from 'lucide-solid'
import { Show } from 'solid-js'

type WelcomeProps = {
  appName: string
  appVersionLabel: string | null
  error: string | null
  onOpen: () => void
}

export function Welcome(props: WelcomeProps) {
  return (
    <div class="welcome-screen">
      <div class="welcome-logo-stage">
        <img class="welcome-logo" src={logoUrl} alt="OpenPi" />
        <span class="welcome-logo-scan" aria-hidden="true" />
      </div>
      <div class="eyebrow">{props.appName}</div>
      <h1>A desktop workbench for Pi coding agent</h1>
      <p>Local-first sessions, model controls, and recoverable agent state.</p>
      <button type="button" class="button-primary" onClick={props.onOpen}>
        <FolderOpen size={15} /> Open workspace
      </button>
      <Show when={props.error}>
        <div class="error-banner">{props.error}</div>
      </Show>
      <Show when={props.appVersionLabel}>
        {(versionLabel) => <span class="welcome-version">{versionLabel()}</span>}
      </Show>
    </div>
  )
}
