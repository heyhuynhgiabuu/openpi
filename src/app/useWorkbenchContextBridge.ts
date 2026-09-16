/**
 * Workbench context bridge: reports the file visible in the preview pane to
 * main, so the desktop layer can show contextual state alongside the workbench.
 */

import { createEffect } from 'solid-js'
import type { useAppFileManager } from '../hooks/useAppFileManager'
import type { useOpenPiSession } from '../hooks/useOpenPiSession'

export function useWorkbenchContextBridge(
  fm: ReturnType<typeof useAppFileManager>,
  session: ReturnType<typeof useOpenPiSession>
): void {
  createEffect(() => {
    const files = fm.openFiles()
    const idx = fm.activeFileIdx()
    const relPath = files[idx]
    const cwd = session.selectedWorkspacePath
    if (relPath && relPath.length > 0 && cwd) {
      const absPath = `${cwd}/${relPath}`
      window.openpi.workbenchContext.update({
        visibleFile: relPath,
        visibleFileAbs: absPath,
        terminalOutput: null,
      })
    } else {
      window.openpi.workbenchContext.update({
        visibleFile: null,
        visibleFileAbs: null,
        terminalOutput: null,
      })
    }
  })
}
