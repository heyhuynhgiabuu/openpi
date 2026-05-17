# OpenPi Test Matrix

Map product behavior to proof. Statuses: `planned`, `in_progress`, `implemented`, `changed`, `retired`.

| Area | Behavior | Status | Evidence | Notes |
|---|---|---|---|---|
| Harness | Goal/harness loop is discoverable via `/goal` | implemented | `/goal` in Composer.tsx, sidecar expansion | |
| Harness | Harness status reports repo-local docs | implemented | `harness_status` extension tool | |
| Harness | Intake classifies intent and risk | implemented | `harness_intake` extension tool | |
| Harness | Harness init scaffolds `docs/` | implemented | `harness_init` extension tool | |
| Harness | Harness lint audits docs for gaps | implemented | `harness_lint` extension tool | |
| Harness | Story packets can be created | implemented | `story_create` extension tool | |
| Harness | Decisions can be recorded | implemented | `decision_record` extension tool | |
| Harness | Test matrix rows can be appended | implemented | `test_matrix_update` extension tool | |
| Harness | Legacy spec tools are compatibility-only | implemented | Labels/descriptions mark legacy; guidance stripped from controller | |
| Harness | Renderer shows harness tool cards | implemented | `HarnessToolRow` in ToolCardView.tsx | |
| Harness | docs/HARNESS.md exists with operating rules | implemented | docs/HARNESS.md | |
| Harness | docs/FEATURE_INTAKE.md exists with risk checklist | implemented | docs/FEATURE_INTAKE.md | |
| Harness | docs/TEST_MATRIX.md exists with evidence rules | implemented | docs/TEST_MATRIX.md | |
| Harness | docs/templates/story.md exists | implemented | docs/templates/story.md | |
| Harness | docs/templates/spec-intake.md exists | implemented | docs/templates/spec-intake.md | |
| Harness | docs/product/ describes goal/harness system | implemented | docs/product/GOAL_HARNESS.md | |
| Harness | docs/product/ describes process model | implemented | docs/product/PROCESS_MODEL.md | |
| Harness | docs/decisions/ records goal-harness-model ADR | implemented | docs/decisions/2026-05-17-goal-harness-model.md | |
| Harness | docs/decisions/ records legacy-adapters ADR | implemented | docs/decisions/2026-05-17-harness-v2-legacy-adapters.md | |
| Harness | docs/decisions/ records renderer-not-authority ADR | implemented | docs/decisions/2026-05-17-renderer-not-authority.md | |
| Harness | docs/stories/ has next-slice story packet | implemented | docs/stories/goal-status-indicator.md | |
| IPC | Renderer never runs Git or filesystem | implemented | Preload boundary, contextIsolation, Zod validation | |
| IPC | All IPC payloads validated by Zod | implemented | Schema definitions in ipc.ts | |
| Tool Cards | `harness_status` shows doc counts | implemented | `parseHarnessOutputSummary` | |
| Tool Cards | `harness_intake` shows classification/risk | implemented | `parseHarnessOutputSummary` | |
| Tool Cards | `story_create` shows criteria count | implemented | `parseHarnessOutputSummary` | |
| Tool Cards | `decision_record` shows status | implemented | `parseHarnessOutputSummary` | |
| Tool Cards | `test_matrix_update` shows area/behavior | implemented | `parseHarnessOutputSummary` | |
| Composer | `/goal` slash command is surfaced | implemented | Slash commands in Composer.tsx | |
| Palette | Goal loop palette entry exists | implemented | `goalLoop` in App.tsx | |
| Extension | Extension typechecks with bundler resolution | implemented | CI verification command | |
| UI | Harness tool cards show `legacy` badge | implemented | `harness-badge--legacy` in ToolCardView.tsx | |
| UI | Goal banner shows when /goal is active | implemented | GoalBanner.tsx | |
| UI | Goal banner shows run/idle step badge | implemented | `goal-badge--running`/`goal-badge--idle` in index.css | |
| UI | Goal banner can be dismissed | implemented | onDismiss clears activeGoalText | |
| Composer | Goal state syncs from /goal &lt;intent&gt; on send | implemented | detectAndSetGoal in useOpenPiSession.send() | |
| Composer | Goal clears on /goal clear or empty /goal | implemented | send() clears activeGoalText | |
| UI | Story browser panel lists stories from docs/stories/ with status badges | implemented | StoryBrowser.tsx |  |
| Tooling | Harness lint pre-commit hook detects missing docs before commit | implemented | scripts/harness-lint.sh, .githooks/pre-commit |  |
| Tooling | Harness lint can be run standalone via npm run precommit | implemented | package.json scripts.precommit |  |
