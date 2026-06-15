/**
 * Material Icon Theme renderer for OpenPi file trees.
 *
 * Best practice: use a real icon theme package instead of hand-rolled file
 * glyphs. `material-icon-theme` is MIT-licensed, ships the SVG assets, and
 * exposes a VS Code icon-theme manifest with exact filename, folder-name, and
 * extension mappings.
 */

import materialIcons from 'material-icon-theme/dist/material-icons.json'
import type { Component } from 'solid-js'

type IconDefinition = { iconPath?: string }
type MaterialIconManifest = {
  iconDefinitions: Record<string, IconDefinition>
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
  file?: string
  folder?: string
  folderExpanded?: string
}

const manifest = materialIcons as MaterialIconManifest

/** material-icon-theme is missing plain .ts extension mapping — add it here. */
const CUSTOM_EXTENSION_ICONS: Record<string, string> = {
  ts: 'typescript',
}

const iconUrls = import.meta.glob('/node_modules/material-icon-theme/icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

function normalizeName(name: string) {
  return name.trim().toLowerCase()
}

function extensionCandidates(name: string) {
  const normalized = normalizeName(name)
  const parts = normalized.split('.').filter(Boolean)
  const candidates: string[] = []

  for (let i = 0; i < parts.length; i += 1) {
    candidates.push(parts.slice(i).join('.'))
  }

  return candidates
}

function iconPathToUrl(iconPath: string | undefined) {
  if (!iconPath) return null

  const fileName = iconPath.split('/').pop()
  if (!fileName) return null

  return iconUrls[`/node_modules/material-icon-theme/icons/${fileName}`] ?? null
}

function iconKeyToUrl(iconKey: string | undefined) {
  if (!iconKey) return null
  return iconPathToUrl(manifest.iconDefinitions[iconKey]?.iconPath)
}

function resolveFileIconUrl(name: string) {
  const normalized = normalizeName(name)

  const exact = iconKeyToUrl(manifest.fileNames[normalized])
  if (exact) return exact

  for (const candidate of extensionCandidates(normalized)) {
    const byExtension = iconKeyToUrl(manifest.fileExtensions[candidate])
    if (byExtension) return byExtension
    const customKey = CUSTOM_EXTENSION_ICONS[candidate]
    if (customKey) return iconKeyToUrl(customKey)
  }

  return iconKeyToUrl(manifest.file) ?? iconKeyToUrl('file')
}

function resolveFolderIconUrl(name: string | undefined, open: boolean | undefined) {
  const normalized = normalizeName(name ?? '')
  const folderMap = open ? manifest.folderNamesExpanded : manifest.folderNames

  const named = iconKeyToUrl(folderMap[normalized])
  if (named) return named

  const fallbackKey = open ? manifest.folderExpanded : manifest.folder
  return iconKeyToUrl(fallbackKey) ?? iconKeyToUrl(open ? 'folder-open' : 'folder')
}

interface FileIconProps {
  name: string
  size?: number
  class?: string
}

export const FileIcon: Component<FileIconProps> = (props) => {
  const size = () => props.size ?? 16
  const src = () => resolveFileIconUrl(props.name)

  return (
    <span
      class={props.class}
      aria-hidden
      style={{ display: 'inline-flex', 'align-items': 'center', 'flex-shrink': '0' }}
    >
      <img
        src={src() ?? ''}
        alt=""
        width={size()}
        height={size()}
        draggable={false}
        style={{ display: 'block', width: `${size()}px`, height: `${size()}px` }}
      />
    </span>
  )
}

export const FolderIcon: Component<{ name?: string; size?: number; open?: boolean }> = (props) => {
  const size = () => props.size ?? 16
  const src = () => resolveFolderIconUrl(props.name, props.open)

  return (
    <span
      aria-hidden
      style={{ display: 'inline-flex', 'align-items': 'center', 'flex-shrink': '0' }}
    >
      <img
        src={src() ?? ''}
        alt=""
        width={size()}
        height={size()}
        draggable={false}
        style={{ display: 'block', width: `${size()}px`, height: `${size()}px` }}
      />
    </span>
  )
}

export const GenericFileIcon: Component<{ size?: number }> = (props) => (
  <FileIcon name="" size={props.size} />
)

// Legacy compat shim for older callers/tests.
export function getIconCfg_compat(name: string) {
  return { iconUrl: resolveFileIconUrl(name) }
}
