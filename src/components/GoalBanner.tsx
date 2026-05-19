import { Square, X } from 'lucide-solid'
import { type Component, Show } from 'solid-js'

export type GoalStep = 'running' | 'idle' | 'paused' | 'budget_limited' | 'complete' | null

export type GoalProgress = {
  tokensUsed: number
  tokenBudget: number | null
  /** 0–1 fraction of budget consumed, or null when budget is unknown */
  percent: number | null
}

type GoalBannerProps = {
  text: string | null
  step: GoalStep
  /** Elapsed wall-clock seconds for the current goal */
  elapsed: number | null
  /** Token consumption progress, if known */
  progress: GoalProgress | null
  onDismiss: () => void
  onAbort: () => void
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export const GoalBanner: Component<GoalBannerProps> = (props) => {
  const isRunning = () => props.step === 'running'
  const badgeLabel = () => (props.step === 'budget_limited' ? 'budget limited' : props.step)

  return (
    <Show when={props.text}>
      <div class="goal-banner">
        {/* ── Goal text ────────────────────────────── */}
        <span class="goal-banner-text" title={props.text!}>
          {props.text!}
        </span>

        {/* ── Elapsed time ─────────────────────────── */}
        <Show when={props.elapsed !== null}>
          <span class="goal-timer" title="Elapsed time">
            {formatElapsed(props.elapsed!)}
          </span>
        </Show>

        {/* ── Progress bar ─────────────────────────── */}
        <Show when={props.progress}>
          <div
            class="goal-progress-wrap"
            title={`${formatTokens(props.progress!.tokensUsed)} tokens used${props.progress!.tokenBudget !== null ? ` / ${formatTokens(props.progress!.tokenBudget)} budget` : ''}`}
          >
            <div class="goal-progress-track">
              <div
                class="goal-progress-fill"
                style={{
                  width:
                    props.progress!.percent !== null
                      ? `${(props.progress!.percent * 100).toFixed(1)}%`
                      : '30%',
                }}
              />
            </div>
          </div>
        </Show>

        {/* ── Step badge ───────────────────────────── */}
        <Show when={props.step}>
          <span class={`goal-badge goal-badge--${props.step}`}>{badgeLabel()}</span>
        </Show>

        {/* ── Abort button (only while running) ───── */}
        <Show when={isRunning()}>
          <button
            type="button"
            class="goal-banner-abort"
            onClick={props.onAbort}
            aria-label="Abort goal"
            title="Abort current goal"
          >
            <Square size={10} strokeWidth={3} fill="currentColor" />
          </button>
        </Show>

        {/* ── Dismiss ──────────────────────────────── */}
        <button
          type="button"
          class="goal-banner-dismiss"
          onClick={props.onDismiss}
          aria-label="Clear goal"
          title="Clear goal"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    </Show>
  )
}
