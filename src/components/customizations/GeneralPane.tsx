import { Show } from 'solid-js'
import type { AppearancePreferences } from '../../lib/appearancePreferences'
import { DISPLAY_PREFERENCES } from '../../lib/displayPreferences'
import { NOTIFICATION_PREFERENCES } from '../../lib/notificationPreferences'
import { POLICY_PREFERENCES } from '../../lib/policyPreferences'
import { AppearanceSection } from './AppearanceSection'
import { BooleanPreferenceSection } from './BooleanPreferenceSection'
import { DiagnosticsSection } from './DiagnosticsSection'
import type { GeneralPaneProps } from './generalPaneTypes'
import { RemoteSection } from './RemoteSection'
import { SoundSection } from './SoundSection'
import { UpdateSection } from './UpdateSection'
import { useGeneralPaneState } from './useGeneralPaneState'

export function GeneralPane(props: GeneralPaneProps) {
  const {
    prefs,
    notificationPrefs,
    policyPrefs,
    soundPrefs,
    updatePrefs,
    updateStatus,
    checkingUpdates,
    installingUpdate,
    installOutput,
    diagnosticsOutput,
    copyingDiagnostics,
    openSoundMenu,
    setOpenSoundMenu,
    savedKey,
    loading,
    closeSoundMenu,
    saveValue,
    resetValue,
    saveNotificationValue,
    resetNotificationValue,
    savePolicyValue,
    resetPolicyValue,
    saveSoundValue,
    resetSoundValue,
    previewSound,
    saveUpdateValue,
    resetUpdateValue,
    checkForUpdates,
    installUpdate,
    copyDiagnostics,
    saveAppearance,
    resetAppearance,
    appearanceRows,
  } = useGeneralPaneState(props)
  return (
    <div class="osp-root">
      <div class="osp-topbar">
        <div class="osp-scope-row">
          <div>
            <div class="osp-title">General</div>
          </div>
        </div>
      </div>

      <Show when={!loading()} fallback={<div class="osp-loading">Loading…</div>}>
        <div class="osp-scroll">
          <AppearanceSection
            appearanceRows={appearanceRows()}
            savedKey={savedKey()}
            onSave={(key, value) =>
              saveAppearance(key as keyof AppearancePreferences, value as never)
            }
            onReset={(key) => resetAppearance(key as keyof AppearancePreferences)}
          />
          <BooleanPreferenceSection
            title="System notifications"
            items={NOTIFICATION_PREFERENCES}
            values={notificationPrefs()}
            savedKey={savedKey()}
            onSave={saveNotificationValue}
            onReset={resetNotificationValue}
          />

          <SoundSection
            soundPrefs={soundPrefs()}
            openSoundMenu={openSoundMenu()}
            savedKey={savedKey()}
            onOpenSoundMenu={setOpenSoundMenu}
            onSave={saveSoundValue}
            onReset={resetSoundValue}
            onPreview={previewSound}
            onClose={closeSoundMenu}
          />

          <BooleanPreferenceSection
            title="Timeline"
            items={DISPLAY_PREFERENCES}
            values={prefs()}
            savedKey={savedKey()}
            onSave={saveValue}
            onReset={resetValue}
          />

          <BooleanPreferenceSection
            title="Agent policy"
            items={POLICY_PREFERENCES}
            values={policyPrefs()}
            savedKey={savedKey()}
            onSave={savePolicyValue}
            onReset={resetPolicyValue}
          />

          <DiagnosticsSection
            diagnosticsOutput={diagnosticsOutput()}
            copyingDiagnostics={copyingDiagnostics()}
            savedKey={savedKey()}
            onCopy={copyDiagnostics}
          />
          <RemoteSection onError={props.onError} />

          <UpdateSection
            updatePrefs={updatePrefs()}
            savedKey={savedKey()}
            updateStatus={updateStatus()}
            checkingUpdates={checkingUpdates()}
            installingUpdate={installingUpdate()}
            installOutput={installOutput()}
            onToggle={saveUpdateValue}
            onReset={resetUpdateValue}
            onCheck={checkForUpdates}
            onInstall={installUpdate}
          />
        </div>
      </Show>

      <div class="osp-footer">
        OpenPi desktop appearance, display, notification, and sound preferences are stored locally.
        Theme selection updates Pi global settings.
      </div>
    </div>
  )
}
