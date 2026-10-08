# PR Workflow

Status: active
Scope: how a change reaches `main` in OpenPi. Pairs with `.github/pull_request_template.md` and `CONTRIBUTING.md`.

## Flow

1. **Issue.** Start from an approved issue. The issue sets the scope; do not expand it in the PR.
2. **Branch.** Branch from current `origin/main`. Name it `<type>/<issue>-<slug>`, e.g. `chore/15-pr-review-setup`.
3. **Tests.** Make one focused change and add tests for behavior changes. Follow the full local verification gate in `CONTRIBUTING.md` (the source of truth), including dependency installation, lint, typecheck, tests, and build. For Electron main/preload, IPC, packaging, or release configuration changes, also run the packaging smoke check documented there.
4. **PR.** Push the branch and open a PR from the template. Link the issue with `Closes #N`. Fill in test evidence and limits, security boundaries, and review disposition.
5. **Review.** Three gates, all required before merge:
   - CI (`.github/workflows/ci.yml`) passes.
   - Greptile review, if enabled, is triaged (see below).
   - A human reviewer approves.
6. **Triage.** Resolve each review comment only with evidence:
   - **Fixed:** cite the commit.
   - **Declined:** state the reason.
   - **Answered:** cite the evidence (test output, command result, or code reference).
7. **Merge.** A human merges after all gates pass.

## Rules

- **No direct commits to `main`.** Every change lands through a PR from a branch.
- **No auto-merge.** Do not enable GitHub auto-merge on PRs.
- **No AI approval in place of a human.** Greptile and coding agents may comment. Only a human reviewer approves.
- **Triage with evidence.** Do not resolve or dismiss review threads silently.
- **One concern per PR.** Keep the diff scoped to the linked issue.
- **Keep secrets and local state out.** Do not commit credentials, `.pi/` local state, `node_modules`, or release builds.
- **Human-understood code.** The author must be able to explain the change and its authority boundaries (`CONTRIBUTING.md`).

## Greptile (automated PR review)

Greptile is optional, advisory review. It does not gate merge by itself and does not replace human review.

Sources (provided as the reference set for this workflow; not independently verified in this repo):

- GitHub App: https://github.com/apps/greptile-apps
- Enable repository: https://app.greptile.com/review/github
- Manual trigger and quick reference: https://www.greptile.com/docs/developer-quick-reference

### Owner setup (one-time, repository owner only)

1. Review Greptile's privacy and data-handling terms, plan and billing, and the permissions requested on the GitHub App install screen. Greptile processes repository code to review it. Record the approval outcome in the setup issue before granting access.
2. Install the `greptile-apps` GitHub App on the account or organization that owns the repo. Choose **Only select repositories** and select only OpenPi; do not grant access to all repositories.
3. Enable the repository at https://app.greptile.com/review/github.
4. Confirm the dashboard is configured to review newly opened PRs only. Avoid automatic reviews on every push unless the owner explicitly approves the cost and noise.

No GitHub Action, API key, or repository secret is required for this setup, per the reference set above.

Do not add a Greptile JSON config file. Its schema has not been verified for this repo, so dashboard defaults are the only supported configuration.

### Using it

- Greptile reviews according to the dashboard settings.
- To request a review manually, comment `@greptileai` on the PR.
- Triage Greptile comments under the rules above, the same as any reviewer comment.

### Verification before claiming it works

Do not describe Greptile as integrated until a real Greptile review has appeared on a PR in this repo. Record that PR link as evidence in the setup issue.

Pricing is not documented here. Check Greptile's pricing page directly before any budget decision. Do not treat any price figure as verified.
