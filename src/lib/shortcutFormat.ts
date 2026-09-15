/**
 * shortcutFormat — render keyboard shortcuts in a platform-aware way.
 *
 * The codebase has historically hardcoded macOS glyphs (`⌘N`, `⌘S`,
 * `⌘⇧F`) in tooltips, which is wrong for Windows and Linux users
 * who see Mac symbols but have a Ctrl or Windows key. This helper
 * keeps a single source of truth: pass a macOS shortcut and a
 * non-macOS shortcut, get the right one for the current platform.
 *
 * Detection: `navigator.platform`, read once at module load.
 */

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

/**
 * Pick the right shortcut string for the current platform.
 *
 * @param mac     shortcut as it should appear on macOS (e.g. `'⌘N'`)
 * @param other   shortcut as it should appear everywhere else
 *                (e.g. `'Ctrl+N'`)
 */
export function formatShortcut(mac: string, other: string): string {
  return IS_MAC ? mac : other
}

/** Returns `true` if the current platform is macOS. */
export function isMacPlatform(): boolean {
  return IS_MAC
}
