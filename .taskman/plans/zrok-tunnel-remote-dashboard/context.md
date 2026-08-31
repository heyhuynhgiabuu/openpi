# Context — zrok tunnel remote dashboard

## Intent
Utente ha fork `rkestt/openpi` (fork di `heyhuynhgiabuu/openpi` v0.2.7 Electron+SolidJS). Vuole dashboard accessibile da browser su altri device via tunnel zrok, come fa `https://pi-dashboard.dev/` e come fa `Relay-pi-dashboard` locale con `server.js` + `zrok share reserved`. Non solo tunnel generico: full workbench remoto.

## Decisions (con reasoning)

- **Full control aperto + dispatch sempre on**: utente vuole reply/steer/interrupt/terminate + creazione nuove sessioni da remoto. Accetta rischio PII/shell. Raccomandato era gated, ma utente ha scelto aperto. Pastor: mantenere gate `needsInput`/409 su reply/steer anche se dispatch on, per non corrompere sessione busy.
- **Basic auth obbligatoria**: zrok `--basic-auth USER:PASS` + server check `RELAY_AUTH_USER/PASS`, warning se `TUNNEL_ORIGIN` senza AUTH, Origin check + `X-Relay-Origin` header su POST. Decisione dopo grill: senza auth URL leak = compromesso.
- **Richiedi zrok installato**: detect `zrok2`/`zrok` via `ToolResolver` con `useLoginShell:true` (macOS GUI PATH stripped). Se manca, UI mostra guida `brew install zrok` + docs.zrok.io. No bundling (+30MB, signing) e no auto-download (supply-chain fragile). Pattern copiato da `pi-dashboard` `zrokResolver`.
- **URL reserved stabile**: `pi-dash-<8hex>.shares.zrok.io` via `zrok create name -n public <name>`, persist `reservedName` in config, auto-mint se `persistent:true` e nessun nome. Fallback ephemeral se reserve fallisce. DNS-safe regex `^[a-z0-9][a-z0-9-]{0,62}$`.
- **Riusa Relay server.js**: 1 file zero-dep `server.js` già fa SSE `/api/stream`, `/api/sessions`, `/api/history`, `/api/dispatch`, polling 1s, `textContent` safe. Spawn da Electron main su `127.0.0.1` porta dinamica, loopback only. Vendor in `electron/vendor/relay-server.js` con `extraResources` in `electron-builder.json` e `resolveAppAssetPath('vendor','relay-server.js')` per prod. Alternativa server nativo scartata per duplicazione.
- **UI token + enable**: campo token in TunnelSection → `zrok enable <token> --headless` (scrive `~/.zrok`), mostra env. Fallback manuale se spawn fallisce.
- **File dedicato userData**: `app.getPath('userData')/zrok.json` + `safeStorage` encrypt per pass (fallback plain se `isEncryptionAvailable()===false`), separato da `settingsHost`. Token zrok mai in plaintext.
- **Solo zrok ora**: niente abstraction multi-provider (zrok/ngrok/tailscale) come pi-dashboard, per surgical.
- **UI TopBar + GeneralPane**: indicatore TopBar (dot verde, URL copy, QR via IPC dataURL generato in main) + dettaglio in `CustomizationsModal > GeneralPane > TunnelSection` (template `DiagnosticsSection`).
- **Auto-restart se enabled**: se config `persistent:true` + `reservedName` salvato, spawn share all'avvio. Toggle opt-in non serve perché utente vuole stabilità.
- **Porta dinamica senza TOCTOU**: non fare `net.createServer(0)` poi close poi spawn. Passa `0` direttamente a relayServer o usa `get-port` con lock atomico, tieni porta riservata fino a spawn.
- **Lifecycle PID/watchdog**: PID file `userData/zrok.pid`, `cleanupStale` su quit, `SIGTERM` per stop, orphan scavenge `ps -ax`, retry 1 volta, 409 gate su mutants.

## Constraints
- Electron boundaries: renderer renders only, main owns fs/PTY/Git/SQLite/secrets. Tunnel spawn 100% main, IPC Zod-validato, preload bridge.
- macOS GUI PATH stripped → `enrichPathFromLoginShell()` necessario.
- zrok v2 API (binary `zrok2`), non v1 `zrok reserve`. Output JSON su stdout con `--subordinate`.
- Sicurezza: mai esporre senza auth, security headers, POST only muta, GET read-only, reply gated da `needsInput`.
- Single plan, non initiative: cambio bounded, 1 sessione coerente.
- Solo additive, no deletions.

## Open questions (post-pastor)
- [x] Dove copiare `server.js`? → `electron/vendor/relay-server.js` + `extraResources` + `resolveAppAssetPath` (pastor must-fix)
- [x] QR generation? → main genera dataURL via IPC, non renderer (pastor nice-to-have)
- [x] RESERVED_NAME_RE invalid? → inline validation in TunnelSection
- [x] Test strategy? → vitest unit + playwright stub come pi-dashboard
- [x] Porta TOCTOU? → fix t-004 (pastor must-fix)
- [x] Deps ordine? → t-007 dipende da t-006 (pastor must-fix)
- [x] Dispatch gate? → 409 check anche se dispatch sempre on (pastor must-fix)

## Discarded options
- **Bundla binario zrok**: +30MB, notarization. Scartato.
- **Auto-download da GitHub**: fragile, supply-chain. Scartato.
- **Abstraction multi-provider da subito**: over-engineering. Rimandato.
- **Server nativo Fastify**: duplicazione relay. Scartato.
- **Ephemeral URL solo**: scomodo. Scartato.
- **Solo Customizations senza TopBar**: non glanceable. Scartato.
- **settingsHost per persistenza**: token plaintext. Scartato.
- **Dispatch gated default**: più sicuro ma utente vuole full aperto — mantenuto ma con 409 guard per busy session (compromesso pastor).

## Pastor review 2026-08-27 (muse-spark-1.2-contributor-free xhigh)
- Must-fix 1: vendor path packaged → fix `extraResources` + `resolveAppAssetPath`
- Must-fix 2: porta TOCTOU race → fix `get-port` lock atomico
- Must-fix 3: t-007 deps rotto → depends su t-006
- Must-fix 4: dispatch senza needsInput gate → aggiungi 409
- Nice-to-have: safeStorage encrypt + QR via main → integrato in t-007/t-009
- Piano patched via `revise_plan` 2026-08-27, ready for /build
