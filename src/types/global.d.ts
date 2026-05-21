import type { OpenPiAPI } from '../../electron/preload'

declare global {
  interface Window {
    openpi: OpenPiAPI
  }
}
