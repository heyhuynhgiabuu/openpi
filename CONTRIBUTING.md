# Contributing to OpenPi

This guide exists to keep the beta useful and maintainable.

## The one rule

**You must understand your change.** If you cannot explain what your code does, what authority boundary it touches, and how it was verified, the change is not ready.

Using AI agents is fine. Submitting agent-generated code you have not reviewed is not.

## Product boundaries

OpenPi is a desktop workbench for the Pi coding agent, not a terminal emulator clone and not a VS Code replacement.

Before proposing or implementing a change, read:

- `AGENTS.md` — architecture rules and ownership boundaries
- `ROADMAP.md` — beta status and planned phases
- `README.md` — current development and packaging commands

Non-negotiable boundaries:

- Renderer code is render-only.
- Electron main owns filesystem, shell, process, SQLite, secrets, and Git authority.
- Pi SDK owns session semantics, tool execution, compaction, and queue behavior.
- IPC payloads must be typed and validated with Zod.
- Do not flatten Pi's session tree into chat history.
- Do not silently install, enable, or execute third-party Pi packages or extensions.

## Quality bar for issues

Keep issues short, concrete, and reproducible.

A good issue includes:

- What happened
- What you expected
- Steps to reproduce
- Relevant logs/screenshots
- Why it matters for the OpenPi beta

Avoid low-signal reports, speculative rewrites, and broad “make it better” requests.

## Before submitting a PR

Run the local verification gate:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

If you changed Electron main/preload, IPC, packaging, or release configuration, also run a packaging smoke check:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false OPENPI_RELEASE_CHANNEL=beta \
  npx electron-builder --config electron-builder.json --dir --publish never
```

## Lockfiles

CI installs with `npm ci`, so **`package-lock.json` is authoritative**: it is what CI lints, typechecks, tests, and builds against. `pnpm-lock.yaml` exists for contributors who prefer pnpm and must resolve the same versions, otherwise a change validated locally can pass or fail differently in CI (for example `@pierre/diffs` 1.4.3 vs 1.2.11 have different `FileDiffOptions` generics).

- **npm:** `npm ci` to install; change dependencies with `npm install`, then commit `package-lock.json`.
- **pnpm:** install with `pnpm install --frozen-lockfile`. Whenever `package-lock.json` changes, regenerate `pnpm-lock.yaml` from it. Do this in a clean temp directory because `pnpm import` prefers an existing `node_modules` over the npm lock:

  ```bash
  tmp=$(mktemp -d) && cp package.json package-lock.json pnpm-workspace.yaml "$tmp" \
    && (cd "$tmp" && pnpm import) && cp "$tmp/pnpm-lock.yaml" pnpm-lock.yaml && rm -rf "$tmp"
  pnpm install --frozen-lockfile --no-optimistic-repeat-install
  ```

  `pnpm-workspace.yaml` is copied so its `overrides` still apply. Do not hand-edit `pnpm-lock.yaml`, and do not commit a `pnpm update`/`pnpm add` result on its own: those resolve against the registry, not `package-lock.json`.

`tests/lockfileSkew.test.ts` (part of `npm test` and CI) fails and names every direct dependency whose version differs between the two lockfiles.

## Release process

Maintainers should use the release helper instead of hand-editing versions and tags:

```bash
npm run release:patch -- --notes "Short release note"
npm run release:prerelease -- --preid beta --notes-file /tmp/openpi-release-notes.md
npm run release:version -- 0.2.0 --notes-file /tmp/openpi-release-notes.md
```

The helper requires a clean worktree and real release notes, updates `package.json`, `package-lock.json`, and `CHANGELOG.md`, runs verification, commits `chore(release): vX.Y.Z`, and creates an annotated `vX.Y.Z` tag. The GitHub release body is generated from the matching `CHANGELOG.md` version section.

## PR expectations

- Keep diffs focused on one concern.
- Include tests for behavior changes.
- Explain any Electron authority boundary touched.
- Call out security, signing, notarization, workspace-trust, or secret-storage implications.
- Do not include generated output, local Pi state, Beads artifacts, `node_modules`, or release builds.
- Do not edit historical roadmap/status claims unless the PR is explicitly documentation cleanup.

## AI-assisted contributions

AI-assisted work is welcome when it is reviewed by a human.

If an agent wrote meaningful code, the PR description should include:

- What the agent changed
- What you reviewed manually
- Which verification commands passed
- Any known caveats or follow-up work

## License

By contributing, you agree that your contribution is licensed under the MIT License in `LICENSE`.
