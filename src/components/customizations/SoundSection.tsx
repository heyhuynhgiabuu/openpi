import { Check, RotateCcw } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type {
  SoundEffectId,
  SoundPreferenceKey,
  SoundPreferences,
} from '../../lib/soundPreferences'
import { SOUND_EFFECT_OPTIONS, SOUND_PREFERENCES } from '../../lib/soundPreferences'

interface SoundSectionProps {
  soundPrefs: SoundPreferences
  openSoundMenu: SoundPreferenceKey | null
  savedKey: string | null
  onOpenSoundMenu: (key: SoundPreferenceKey | null) => void
  onSave: (key: SoundPreferenceKey, value: SoundEffectId) => void
  onReset: (key: SoundPreferenceKey) => void
  onPreview: (sound: SoundEffectId) => void
  onClose: () => void
}

export function SoundSection(props: SoundSectionProps) {
  return (
    <section class="osp-section osp-section-sound">
      <div class="osp-section-head">Sound effects</div>
      <For each={SOUND_PREFERENCES}>
        {(field, i) => {
          const selected = () => props.soundPrefs[field.key]
          const selectedOption = () =>
            SOUND_EFFECT_OPTIONS.find((option) => option.value === selected()) ??
            SOUND_EFFECT_OPTIONS[0]
          const isOpen = () => props.openSoundMenu === field.key
          const isDefault = () => selected() === field.defaultValue
          const justSaved = () => props.savedKey === field.key
          return (
            <div class={`osp-row${i() === SOUND_PREFERENCES.length - 1 ? ' osp-row-last' : ''}`}>
              <div class="osp-row-left">
                <div class="osp-row-name">
                  {field.label}
                  <Show when={justSaved()}>
                    <span class="osp-saved">
                      <Check size={10} /> saved
                    </span>
                  </Show>
                </div>
                <div class="osp-row-desc">{field.description}</div>
              </div>
              <div class="osp-row-right">
                <Show when={!isDefault()}>
                  <button
                    class="osp-reset-btn"
                    type="button"
                    onClick={() => props.onReset(field.key)}
                    title="Reset to default"
                  >
                    <RotateCcw size={11} />
                  </button>
                </Show>
                <div class="osp-sound-picker">
                  <button
                    class="osp-sound-trigger"
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={isOpen()}
                    aria-label={`${field.label} sound effect`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => props.onOpenSoundMenu(isOpen() ? null : field.key)}
                  >
                    <span>{selectedOption().label}</span>
                    <span class="osp-sound-caret" aria-hidden="true">
                      ▾
                    </span>
                  </button>
                  <Show when={isOpen()}>
                    <div
                      class="osp-sound-menu"
                      role="listbox"
                      aria-label={`${field.label} sound effects`}
                    >
                      <For each={SOUND_EFFECT_OPTIONS}>
                        {(option) => {
                          const optionSelected = () => option.value === selected()
                          return (
                            <button
                              class={`osp-sound-option${optionSelected() ? ' is-selected' : ''}`}
                              type="button"
                              role="option"
                              aria-selected={optionSelected()}
                              title={option.description}
                              onMouseDown={(event) => event.stopPropagation()}
                              onMouseEnter={() => props.onPreview(option.value)}
                              onFocus={() => props.onPreview(option.value)}
                              onClick={() => {
                                props.onSave(field.key, option.value)
                                props.onPreview(option.value)
                                props.onClose()
                              }}
                            >
                              {option.label}
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          )
        }}
      </For>
    </section>
  )
}
