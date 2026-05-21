export const THEME_DEFAULT = '__default__'

export const BUILT_IN_THEME_OPTIONS = [
  { value: THEME_DEFAULT, label: 'Default (follow Pi theme)' },
  { value: 'catppuccin-latte', label: 'Catppuccin Latte' },
  { value: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { value: 'everforest-light', label: 'Everforest Light' },
  { value: 'everforest-dark', label: 'Everforest Dark' },
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'nord', label: 'Nord' },
  { value: 'solarized-light', label: 'Solarized Light' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'tokyo-night', label: 'Tokyo Night' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'one-dark-pro', label: 'One Dark Pro' },
]

export interface GeneralPaneProps {
  onError: (message: string) => void
  themeItems: import('../../lib/ipc').CustomizationItem[]
}
