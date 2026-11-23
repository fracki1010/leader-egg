# Harness decisions

- Accepted plan `986eeb9c6ec56327e4325f5d60a8b8cc89746d0959c4b738ffc223ae1bd6b5a9`.
- Project kind: software.
- SDD: selected.

## 2026-11-22 — One repository for backend and frontend

- **Options:** (a) two repositories, one for `leader-egg-back` and one for `leader-egg-front`; (b) one repository with both folders.
- **Chosen:** (b). The user confirmed both folders are the same project.
- **Why:** one history, and changes that touch both sides land together.
- **Result:** backend moved to `leader-egg-back/` (PR #3, merge commit `e6268f9`); frontend moved to `leader-egg-front/` (PR #4, merge commit `486f9a5`).
- **Not done:** the old nested `.git` directories were moved to `.backups/` and not deleted. The frontend's old history includes a tracked `.env`, and it is never pushed.

## 2026-11-22 — Local CI instead of paid GitHub Actions

- **Options:** (a) GitHub Actions (free for public repositories, but the account is locked for billing); (b) a self-hosted runner on this machine; (c) an external CI service; (d) a local `pre-push` hook.
- **Chosen:** (d). The user does not want to pay and does not want a new external dependency.
- **Why:** the hook is free and needs no network. Its limit: it can be skipped with `git push --no-verify`, and it only covers the backend.
- **Result:** `.git/hooks/pre-push` runs the backend type-check and tests. It is not versioned; each clone must install it.
- **Reversal:** the workflow `ci.yml` was added in commit `2d8498e` and removed in `fb3de2d`, while billing is locked.

## 2026-11-22 — Ignore `.env` in the frontend

- **Options:** keep `.env` tracked, or ignore it and keep only `.env.example`.
- **Chosen:** ignore it.
- **Why:** the convention is to version the template only. The file held one variable, `VITE_API_BASE_URL`, and no credentials.

## 2026-11-22 — File names in kebab-case

- **Options:** rename `creditService.ts` to `credit-service.ts`, or accept camelCase for service files.
- **Chosen:** rename, in PR #5 (commit `1c28250`, merge commit `281858f`).
- **Why:** every other backend file already used kebab-case; the constitution section 3 records the rule.

## 2026-11-22 — Constitution v1.0.0 ratified

- **Options:** ratify now, or keep the draft until the code's CI exists.
- **Chosen:** ratify now, with the explicit yes of the owner.
- **Why:** the rules are checked by hand until CI returns; ratifying makes them the bar that reviews and `verify` use.
- **Gaps accepted:** rules without a check are listed in each section of `02-DOCS/wiki/sdd/constitution.md`.
- **Source:** `02-DOCS/wiki/sdd/constitution.md`, amendment log row v1.0.0; `REVIEW.md`.

## 2026-11-22 — Unlock `main` for direct commits

- **Options:** (a) keep `main` closed and use a branch and PR for each change; (b) unlock `main` with the project switch `.rsc/.no-trunk-guard`.
- **Chosen:** (b), at the owner's request.
- **Why:** the owner decides the flow for this project. The switch is the rsc mechanism for it; the lock file `.rsc/.no-trunk-open` is unchanged.
- **Result:** commit `3c74200` (npm audit fixes and the switch) went straight to `main`. Constitution section 4, rule 1 changed in v1.1.0.
- **Limit:** `pre-push` still runs the backend tests; there is no server-side check.

## 2026-11-22 — Merge commits for pull requests

- **Options:** merge commit, squash, rebase.
- **Chosen:** merge commit, for PRs #3, #4 and #5.
- **Why:** each branch's commits stay visible in history. Recorded in the constitution, section 4.
