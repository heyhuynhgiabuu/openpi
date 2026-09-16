/**
 * Workbench context bridge: reports what the user is looking at — the file in
 * the preview pane and the visible terminal's recent output — to main, where it
 * feeds the steering context prefix.
 */

import { createEffect } from 'solid-js'
import type { useAppFileManager } from '../hooks/useAppFileManager'
import type { useOpenPiSession } from '../hooks/useOpenPiSession'
import { terminalSnippet } from '../lib/terminalSnippet'

export function useWorkbenchContextBridge(
  fm: ReturnType<typeof useAppFileManager>,
  session: ReturnType<typeof useOpenPiSession>
): void {
  createEffect(() => {
    const files = fm.openFiles()
    const idx = fm.activeFileIdx()
    const relPath = files[idx]
    const cwd = session.selectedWorkspacePath
    const snippet = terminalSnippet()
    if (relPath && relPath.length > 0 && cwd) {
      const absPath = `${cwd}/${relPath}`
      window.openpi.workbenchContext.update({
        visibleFile: relPath,
        visibleFileAbs: absPath,
        terminalOutput: snippet,
      })
    } else {
      window.openpi.workbenchContext.update({
        visibleFile: null,
        visibleFileAbs: null,
        terminalOutput: snippet,
      })
    }
  })
}
