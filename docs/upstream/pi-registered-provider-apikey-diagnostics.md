# Upstream report (draft — file against earendil-works/pi)

**Title:** Extension-registered providers without `apiKey` are silently unselectable (no registration or selection diagnostic)

## Summary

When an extension registers a provider via `pi.registerProvider(name, config)` and the
config omits `apiKey`, registration succeeds and the extension loads without errors —
but the provider's models can never be selected. `session.setModel()` on such a model
silently does nothing observable (in our host: the model field never changes; no error,
no event). If the host is not the interactive TUI (which filters unconfigured providers
from its picker), there is no signal anywhere that the provider was dropped or why.

## Environment

- `@earendil-works/pi-coding-agent` 0.85.0 (SDK, host-embedded child process), Node 22
- Provider registered from a project extension through the extension loader (jiti)
- Provider `streamSimple` implementation — no HTTP request is ever made, so the
  missing credential is not the functional blocker; the registry gates selection on it

## Minimal repro (matrix)

One extension, identical except for the `registerProvider` config:

| config | provider registers | model selectable via `setModel` |
|---|---|---|
| minimal (`baseUrl`, `api`, `models[{id,name,contextWindow,maxTokens}]`) | yes | **no — silent** |
| minimal + `apiKey` | yes | **yes** |
| minimal + `name` (no apiKey) | yes | no |
| minimal + full model metadata `reasoning`/`input`/`cost` (no apiKey) | yes | no |

The only discriminator is the presence of `apiKey`. Nothing is logged, no
`extension_error` is emitted, and the provider appears registered to the host.

## Expected

At least one of:

1. A warning when a provider is registered without credentials (e.g. "provider
   'scripted' has no apiKey; its models will not be selectable until configured"), or
2. A diagnostic on `setModel()` failure naming the reason ("model X is not selectable:
   provider has no configured credential"), or
3. A documented, supported way to mark an extension provider as credential-free —
   `streamSimple` providers that never touch the network (embedded hosts, tests,
   scripted drivers) cannot satisfy an apiKey requirement meaningfully.

## Why it matters

Hosts embedding the SDK (desktop apps, test harnesses) register in-process providers
precisely because they don't need user credentials. The silent gate makes the failure
mode "my registered provider just doesn't exist" with zero diagnostic, which cost us a
misdiagnosis cycle (we first suspected a TypeScript extension-loading problem).

## Suggested direction

`ModelRegistry.registerProvider` (or the flush of
`pendingProviderRegistrations` in `bindCore`) could validate that every model in a
registered provider either has `apiKey` or belongs to a provider with a configured
credential source, and surface a warning through the extension error channel when not.
