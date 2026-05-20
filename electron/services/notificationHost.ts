import type { BrowserWindow } from 'electron'
import { Notification, shell } from 'electron'
import { IPC } from '../../src/lib/ipc'
import {
  NOTIFICATION_PREFERENCES,
  type NotificationPreferenceKey,
  notificationStorageKey,
} from '../../src/lib/notificationPreferences'
import {
  SOUND_PREFERENCES,
  type SoundEffectId,
  type SoundPreferenceKey,
  sanitizeSoundEffect,
  soundStorageKey,
} from '../../src/lib/soundPreferences'
import type { SessionIndexStore } from '../session/sessionIndex'

/**
 * Convert a SoundEffectId into an array of delay-milliseconds.
 * Each delay triggers one shell.beep() call.
 */
export function soundEffectPattern(effect: SoundEffectId): number[] {
  if (effect === 'none') return []

  const match = /^(alert|bip-bop|staplebops|nope|yup)-(\d+)$/.exec(effect)
  if (!match) return []

  const family = match[1]
  const variant = Number(match[2] ?? 1)
  const offset = (variant % 4) * 20

  switch (family) {
    case 'alert':
      return variant % 3 === 0 ? [0, 180 + offset] : [0]
    case 'bip-bop':
      return [0, 110 + offset]
    case 'staplebops':
      return Array.from({ length: Math.min(variant + 1, 5) }, (_, index) => index * (70 + offset))
    case 'nope':
      return variant % 2 === 0 ? [0, 90 + offset, 360 + offset] : [0, 260 + offset]
    case 'yup':
      return variant % 2 === 0 ? [0, 140 + offset] : [0]
    default:
      return []
  }
}

/**
 * Truncate a notification body to 180 characters with ellipsis.
 */
export function notificationBody(text: string): string {
  return text.length > 180 ? `${text.slice(0, 177)}…` : text
}

/**
 * Play a sound effect by scheduling shell.beep() calls at the
 * delay intervals defined by soundEffectPattern.
 */
export function playSoundEffectId(effect: SoundEffectId): void {
  for (const delayMs of soundEffectPattern(effect)) {
    setTimeout(() => shell.beep(), delayMs)
  }
}

// ── Module-level references ────────────────────────────────────────────────────
// Setters avoid threading sessionIndex/mainWindow through every call site.

let _mainWindow: BrowserWindow | null = null
let _sessionIndex: SessionIndexStore | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  _mainWindow = win
}

export function setSessionIndex(si: SessionIndexStore | null): void {
  _sessionIndex = si
}

// ── Preference-read helpers ────────────────────────────────────────────────────
// These read from the session-index preference store and fall back to defaults.

export function notificationPref(key: NotificationPreferenceKey): boolean {
  const meta = NOTIFICATION_PREFERENCES.find((item) => item.key === key)
  const raw = _sessionIndex?.getPref(notificationStorageKey(key))
  if (raw == null || raw === '') return meta?.defaultValue ?? false
  return raw === 'true'
}

export function selectedSoundEffect(key: SoundPreferenceKey): SoundEffectId {
  const meta = SOUND_PREFERENCES.find((item) => item.key === key)
  const raw = _sessionIndex?.getPref(soundStorageKey(key))
  if (raw == null || raw === '') return meta?.defaultValue ?? 'none'
  return sanitizeSoundEffect(raw)
}

// ── Notification display ───────────────────────────────────────────────────────

export function showSystemNotification(
  key: NotificationPreferenceKey,
  title: string,
  body: string
): void {
  if (!notificationPref(key)) return
  if (!Notification.isSupported()) return
  if (_mainWindow?.isFocused()) return
  new Notification({ title, body: notificationBody(body) }).show()
}

export function playSoundEffect(key: SoundPreferenceKey): void {
  playSoundEffectId(selectedSoundEffect(key))
}

export function emitSessionError(message: string, code?: string): void {
  _mainWindow?.webContents.send(IPC.SESSION_ERROR, {
    message,
    ...(code ? { code } : {}),
  })
  showSystemNotification('notifyErrors', 'OpenPi error', message)
  playSoundEffect('soundErrors')
}
