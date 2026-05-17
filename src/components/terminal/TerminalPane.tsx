import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import {
  APPEARANCE_PREFERENCES_CHANGED_EVENT,
  type AppearancePreferences,
  buildTerminalFontStack,
  loadAppearancePreferences,
} from '../../lib/appearancePreferences'
import 'nerdfonts-web/nf.css'

interface Props {
  id: string
  cwd: string
  isVisible: boolean
  /** Called when the PTY process exits */
  onExit?: (id: string) => void
}

const NERD_SYMBOL_FONT = 'NerdFontsSymbols Nerd Font'

async function loadTerminalFonts(fontSize: number, preferredFont = ''): Promise<void> {
  if (!document.fonts?.load) return

  const fontNames = [preferredFont, NERD_SYMBOL_FONT]
    .flatMap((font) => font.split(','))
    .map((font) => font.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)

  await Promise.allSettled(fontNames.map((font) => document.fonts.load(`${fontSize}px "${font}"`)))
}

export function TerminalPane(props: Props) {
  let containerRef!: HTMLDivElement
  let term: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ptyId: string | null = null
  const [terminalReady, setTerminalReady] = createSignal(false)

  onMount(() => {
    let disposed = false
    let onDataDisposable: { dispose: () => void } | null = null
    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null

    const fontSize = 12
    const nextTerm = new Terminal({
      theme: {
        background: '#0c0b0a',
        foreground: '#e4e0d8',
        cursor: '#e4e0d8',
        cursorAccent: '#0c0b0a',
        selectionBackground: 'rgba(244,241,236,0.2)',
        black: '#1a1a1a',
        brightBlack: '#3a3a3a',
        red: '#e06c75',
        brightRed: '#e06c75',
        green: '#98c379',
        brightGreen: '#98c379',
        yellow: '#e5c07b',
        brightYellow: '#e5c07b',
        blue: '#61afef',
        brightBlue: '#61afef',
        magenta: '#c678dd',
        brightMagenta: '#c678dd',
        cyan: '#56b6c2',
        brightCyan: '#56b6c2',
        white: '#d4d4d4',
        brightWhite: '#ffffff',
      },
      fontFamily: buildTerminalFontStack(''),
      fontSize,
      lineHeight: 1.35,
      cursorStyle: 'bar',
      cursorBlink: true,
      scrollback: 5000,
      customGlyphs: true,
      allowProposedApi: true,
    })

    const nextFitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    nextTerm.loadAddon(nextFitAddon)
    nextTerm.loadAddon(webLinksAddon)

    const applyTerminalFont = (prefs: AppearancePreferences) => {
      nextTerm.options.fontFamily = buildTerminalFontStack(prefs.terminalFont)
      if (fitAddon && term) {
        try {
          fitAddon.fit()
          if (ptyId) window.openpi.pty.resize(ptyId, term.cols, term.rows)
        } catch {
          // ignore transient resize failures while the terminal is hidden.
        }
      }
    }

    const onAppearanceChanged = (event: Event) => {
      applyTerminalFont((event as CustomEvent<AppearancePreferences>).detail)
    }
    window.addEventListener(APPEARANCE_PREFERENCES_CHANGED_EVENT, onAppearanceChanged)

    const startTerminal = async () => {
      const appearance = await loadAppearancePreferences().catch(() => null)
      if (appearance) applyTerminalFont(appearance)
      await loadTerminalFonts(fontSize, appearance?.terminalFont ?? '')
      if (disposed) return

      nextTerm.open(containerRef)
      nextFitAddon.fit()

      term = nextTerm
      fitAddon = nextFitAddon
      setTerminalReady(true)

      const { cols, rows } = nextTerm
      void window.openpi.pty.create(props.cwd, cols, rows).then((id) => {
        if (disposed) {
          void window.openpi.pty.close(id)
          return
        }
        ptyId = id
        window.openpi.pty.resize(id, nextTerm.cols, nextTerm.rows)
      })

      onDataDisposable = nextTerm.onData((data) => {
        if (ptyId) window.openpi.pty.write(ptyId, data)
      })

      unsubData = window.openpi.pty.onData(({ id, data }) => {
        if (id === ptyId) nextTerm.write(data)
      })

      unsubExit = window.openpi.pty.onExit(({ id }) => {
        if (id === ptyId) {
          nextTerm.write('\r\n[Process exited]\r\n')
          ptyId = null
        }
      })
    }

    void startTerminal()

    onCleanup(() => {
      disposed = true
      onDataDisposable?.dispose()
      unsubData?.()
      unsubExit?.()
      if (ptyId) {
        void window.openpi.pty.close(ptyId)
        ptyId = null
      }
      window.removeEventListener(APPEARANCE_PREFERENCES_CHANGED_EVENT, onAppearanceChanged)
      nextTerm.dispose()
      term = null
      fitAddon = null
      setTerminalReady(false)
    })
  })

  createEffect(() => {
    if (!props.isVisible || !terminalReady() || !fitAddon || !term) return

    const fit = () => {
      if (!fitAddon || !term || !containerRef.offsetWidth || !containerRef.offsetHeight) return
      try {
        fitAddon.fit()
        if (ptyId) {
          window.openpi.pty.resize(ptyId, term.cols, term.rows)
        }
      } catch {
        // ignore transient fit failures while the panel is animating or hidden.
      }
    }

    const animationFrame = requestAnimationFrame(fit)
    const timer = setTimeout(fit, 80)
    const observer = new ResizeObserver(fit)
    observer.observe(containerRef)

    if (containerRef.parentElement) {
      observer.observe(containerRef.parentElement)
    }

    onCleanup(() => {
      cancelAnimationFrame(animationFrame)
      clearTimeout(timer)
      observer.disconnect()
    })
  })

  return (
    <div
      ref={(el) => {
        containerRef = el
      }}
      class="terminal-pane-inner"
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  )
}
