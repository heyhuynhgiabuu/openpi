/**
 * panelLayout.ts — layout types for the git panel drag-and-drop.
 *
 * The sessions sidebar is always fixed on the left.
 * Only the git panel can be repositioned: left or right of the main conversation pane.
 *
 *   [sessions sidebar (fixed left)] | [git?] | [main pane] | [git?]
 */

export type GitPanelSide = 'left' | 'right'

export const DEFAULT_GIT_PANEL_SIDE: GitPanelSide = 'right'

/** Parse the persisted string value, defaulting to 'right'. */
export function parseGitPanelSide(raw: string | null): GitPanelSide {
  return raw === 'left' ? 'left' : 'right'
}
