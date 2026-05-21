import { createSignal, onMount } from 'solid-js'
import { DEFAULT_GIT_PANEL_SIDE, type GitPanelSide, parseGitPanelSide } from '../lib/panelLayout'

const SIDEBAR_DEFAULT = 280
const GIT_PANEL_DEFAULT = 260
const SIDEBAR_MIN = 240
const SIDEBAR_MAX = 480
const GIT_MIN = 300
const GIT_MAX = 560
const PREVIEW_DEFAULT = 480
const PREVIEW_MIN = 280
const PREVIEW_MAX = 900

export function useWorkbenchLayout() {
  const [gitPanelSide, setGitPanelSide] = createSignal<GitPanelSide>(DEFAULT_GIT_PANEL_SIDE)
  const [isDraggingGit, setIsDraggingGit] = createSignal(false)
  const [dropSide, setDropSide] = createSignal<GitPanelSide | null>(null)
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT)
  const [gitPanelWidth, setGitPanelWidth] = createSignal(GIT_PANEL_DEFAULT)
  const [previewWidth, setPreviewWidth] = createSignal(PREVIEW_DEFAULT)
  let workbenchRef: HTMLDivElement | undefined

  const setWorkbenchRef = (element: HTMLDivElement) => {
    workbenchRef = element
  }

  const startGitDrag = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingGit(true)
    setDropSide(gitPanelSide())
    document.body.classList.add('panel-dragging')

    const onMove = (moveEvent: MouseEvent) => {
      if (!workbenchRef) return
      const rect = workbenchRef.getBoundingClientRect()
      setDropSide((moveEvent.clientX - rect.left) / rect.width < 0.5 ? 'left' : 'right')
    }
    const onUp = () => {
      const target = dropSide()
      if (target && target !== gitPanelSide()) {
        setGitPanelSide(target)
        void window.openpi.setPref('panel.git_side', target)
      }
      setIsDraggingGit(false)
      setDropSide(null)
      document.body.classList.remove('panel-dragging')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  onMount(() => {
    window.openpi
      .getPref('panel.sidebar_width')
      .then((value) => {
        const next = value ? parseInt(value, 10) : NaN
        if (!Number.isNaN(next)) setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, next)))
      })
      .catch(() => {})
    window.openpi
      .getPref('panel.git_panel_width')
      .then((value) => {
        const next = value ? parseInt(value, 10) : NaN
        if (!Number.isNaN(next)) setGitPanelWidth(Math.max(GIT_MIN, Math.min(GIT_MAX, next)))
      })
      .catch(() => {})
    window.openpi
      .getPref('panel.git_side')
      .then((raw) => setGitPanelSide(parseGitPanelSide(raw)))
      .catch(() => {})
  })

  const resizeSidebar = (delta: number) => {
    setSidebarWidth((prev) => {
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, prev + delta))
      void window.openpi.setPref('panel.sidebar_width', String(next))
      return next
    })
  }

  const resizeGitPanel = (delta: number) => {
    const sign = gitPanelSide() === 'left' ? 1 : -1
    setGitPanelWidth((prev) => {
      const next = Math.max(GIT_MIN, Math.min(GIT_MAX, prev + sign * delta))
      void window.openpi.setPref('panel.git_panel_width', String(next))
      return next
    })
  }

  const resizePreview = (delta: number) => {
    setPreviewWidth((prev) => Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, prev - delta)))
  }

  return {
    gitPanelSide,
    isDraggingGit,
    dropSide,
    sidebarWidth,
    gitPanelWidth,
    previewWidth,
    setWorkbenchRef,
    startGitDrag,
    resizeSidebar,
    resizeGitPanel,
    resizePreview,
  }
}
