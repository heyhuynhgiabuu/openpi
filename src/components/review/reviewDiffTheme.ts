export const REVIEW_DIFF_BACKGROUND = 'var(--surface-card)'
export const REVIEW_DIFF_ADDITION_BACKGROUND =
  'color-mix(in srgb, var(--surface-card) 36%, var(--success-soft) 64%)'
export const REVIEW_DIFF_ADDITION_NUMBER_BACKGROUND =
  'color-mix(in srgb, var(--success-soft) 72%, var(--success-line) 28%)'
export const REVIEW_DIFF_DELETION_BACKGROUND =
  'color-mix(in srgb, var(--surface-card) 34%, var(--error-soft) 66%)'
export const REVIEW_DIFF_DELETION_NUMBER_BACKGROUND =
  'color-mix(in srgb, var(--error-soft) 70%, var(--error-line) 30%)'

export function applyReviewDiffTheme(node: HTMLElement): void {
  node.style.backgroundColor = REVIEW_DIFF_BACKGROUND
  node.style.setProperty('--diffs-bg', REVIEW_DIFF_BACKGROUND)
  node.style.setProperty('--diffs-light-bg', REVIEW_DIFF_BACKGROUND)
  node.style.setProperty('--diffs-dark-bg', REVIEW_DIFF_BACKGROUND)
  node.style.setProperty('--diffs-bg-addition-override', REVIEW_DIFF_ADDITION_BACKGROUND)
  node.style.setProperty(
    '--diffs-bg-addition-number-override',
    REVIEW_DIFF_ADDITION_NUMBER_BACKGROUND
  )
  node.style.setProperty('--diffs-bg-deletion-override', REVIEW_DIFF_DELETION_BACKGROUND)
  node.style.setProperty(
    '--diffs-bg-deletion-number-override',
    REVIEW_DIFF_DELETION_NUMBER_BACKGROUND
  )

  const shadowRoot = node.shadowRoot
  if (!shadowRoot) return

  let style = shadowRoot.querySelector<HTMLStyleElement>('style[data-openpi-review-theme]')
  if (!style) {
    style = document.createElement('style')
    style.dataset.openpiReviewTheme = 'true'
    shadowRoot.appendChild(style)
  }

  style.textContent = `
    :host {
      background-color: ${REVIEW_DIFF_BACKGROUND} !important;
      --diffs-bg: ${REVIEW_DIFF_BACKGROUND} !important;
      --diffs-light-bg: ${REVIEW_DIFF_BACKGROUND} !important;
      --diffs-dark-bg: ${REVIEW_DIFF_BACKGROUND} !important;
      --diffs-bg-addition-override: ${REVIEW_DIFF_ADDITION_BACKGROUND} !important;
      --diffs-bg-addition-number-override: ${REVIEW_DIFF_ADDITION_NUMBER_BACKGROUND} !important;
      --diffs-bg-deletion-override: ${REVIEW_DIFF_DELETION_BACKGROUND} !important;
      --diffs-bg-deletion-number-override: ${REVIEW_DIFF_DELETION_NUMBER_BACKGROUND} !important;
    }

    pre,
    code,
    [data-diff],
    [data-content],
    [data-gutter] {
      background-color: var(--diffs-bg) !important;
    }

    [data-line-type='change-addition']:is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline]) {
      background-color: ${REVIEW_DIFF_ADDITION_BACKGROUND} !important;
    }

    [data-line-type='change-addition']:is([data-column-number], [data-gutter-buffer]) {
      background-color: ${REVIEW_DIFF_ADDITION_NUMBER_BACKGROUND} !important;
    }

    [data-line-type='change-deletion']:is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline]) {
      background-color: ${REVIEW_DIFF_DELETION_BACKGROUND} !important;
    }

    [data-line-type='change-deletion']:is([data-column-number], [data-gutter-buffer]) {
      background-color: ${REVIEW_DIFF_DELETION_NUMBER_BACKGROUND} !important;
    }

    /* Selected line(s) for line-comments: color the full row, not only code text. */
    :is([data-line], [data-gutter-buffer], [data-no-newline])[data-selected-line],
    :is([data-line], [data-gutter-buffer], [data-no-newline])[data-selected-line='first'],
    :is([data-line], [data-gutter-buffer], [data-no-newline])[data-selected-line='last'] {
      background-color: color-mix(in srgb, var(--warning) 24%, var(--surface-card) 76%) !important;
    }

    [data-column-number][data-selected-line],
    [data-column-number][data-selected-line='first'],
    [data-column-number][data-selected-line='last'] {
      background-color: color-mix(in srgb, var(--warning) 36%, var(--surface-card) 64%) !important;
      box-shadow: inset 4px 0 0 0 var(--warning);
    }

    [data-column-number][data-selected-line]::before,
    [data-column-number][data-selected-line='first']::before,
    [data-column-number][data-selected-line='last']::before {
      background: var(--warning) !important;
      background-image: none !important;
      opacity: 1 !important;
    }

    /* Hover feedback on changed rows. Pierre sets data-hovered on line pieces. */
    [data-line-type='change-addition']:is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline]):is(:hover, [data-hovered]) {
      background-color: color-mix(in srgb, ${REVIEW_DIFF_ADDITION_BACKGROUND} 78%, var(--warning) 22%) !important;
    }

    [data-line-type='change-deletion']:is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline]):is(:hover, [data-hovered]) {
      background-color: color-mix(in srgb, ${REVIEW_DIFF_DELETION_BACKGROUND} 78%, var(--warning) 22%) !important;
    }

    /* OpenCode-style hover add-comment button rendered via Pierre renderGutterUtility. */
    [data-openpi-hover-comment] {
      background-color: var(--warning) !important;
      color: var(--surface-card) !important;
    }

    [data-openpi-hover-comment]:hover,
    [data-openpi-hover-comment]:focus-visible {
      background-color: color-mix(in srgb, var(--warning) 86%, white 14%) !important;
      color: var(--surface-card) !important;
      transform: scale(1.08);
    }
  `
}
