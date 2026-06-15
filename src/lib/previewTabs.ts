const DIFF_PREVIEW_TAB = 'openpi-diff://review'

export function makeDiffPreviewTab(): string {
  return DIFF_PREVIEW_TAB
}

export function isDiffPreviewTab(tab: string | undefined): boolean {
  return tab === DIFF_PREVIEW_TAB
}

export function diffPreviewPath(tab: string): string {
  return isDiffPreviewTab(tab) ? 'Review' : tab
}
