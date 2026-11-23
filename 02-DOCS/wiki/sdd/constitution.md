---
type: constitution
title: leader-egg — Constitution
description: Ratified project constitution for leader-egg (v1.1.0). Principles, quality bar, conventions, security, accessibility, performance and knowledge rules.
tags: [sdd, constitution]
timestamp: 2026-11-22T00:00:00Z
topic: sdd
status: ratified
version: v1.1.0
---

# leader-egg — Constitution

## Known facts (from onboarding)

- Goal: gestionar la venta de huevos y la ubicación de clientes, y mejorar el agente de la app para que pueda trabajar de forma automática.
- Project kind: software · software scope: growing
- How code changes land: branches closed with a pull request; the default branch is closed to direct work (section 4).

## 1. Stack canon

1. Backend (`leader-egg-back/`): Node.js 20 or newer, TypeScript with `strict` on, Express, MongoDB through Mongoose, Redis, Zod for validation, JWT and bcrypt for authentication. npm, with a committed `package-lock.json`. _Verified in `leader-egg-back/package.json`._
2. Frontend (`leader-egg-front/`): React with Vite and TypeScript (`strict`), MUI, TanStack Query, Zustand, Firebase, Leaflet, and a PWA through `vite-plugin-pwa`. npm, with a committed `package-lock.json`. _Verified in `leader-egg-front/package.json`._
3. Tests: Vitest in both packages; Supertest and `mongodb-memory-server` in the backend; Testing Library in the frontend. _Verified in both `package.json` files._

## 2. Quality bar

1. A change merges only when the test suite passes: `npm test` in `leader-egg-back` and in `leader-egg-front` (Vitest).
2. The backend type-checks clean with `strict` on: `npm run lint` in `leader-egg-back` (`tsc --noEmit`) reports zero errors.
3. The frontend lints clean: `npm run lint` in `leader-egg-front` (ESLint) reports zero errors.
4. A person reviews every change before it merges.

_Enforcement gap: no CI workflow exists yet, so rules 1–3 are checked by hand until one is added._

## 3. Conventions

1. Each backend feature lives in `leader-egg-back/src/modules/<name>/` with `routes.ts`, `controller.ts`, `service.ts` and `schema.ts` (Zod validation). _Verified: the layout in `leader-egg-back/src/modules/accounts/`._
2. Frontend code is grouped by role: pages in `src/pages/`, reusable UI in `src/components/`, server calls in `src/api/`, React Query hooks in `src/hooks/queries/`. _Verified: folders exist in `leader-egg-front/src/`._
3. Every commit header follows gitmoji plus Conventional Commits, for example `🔧 chore: ...`. _Enforced: the project's commit hook rejected a commit without a gitmoji during this session._
4. File names use kebab-case. _Pending decision: `creditService.ts` breaks this rule, and the team has to choose between renaming it or accepting camelCase for service files._
5. There is no shared formatter configuration in either package. _Gap: needs a decision (for example Prettier in both packages); until then, formatting is not checked._

_Enforcement gap: rules 1 and 2 are checked by review; rule 3 is checked by the commit hook; rules 4 and 5 have no check yet._

## 4. Branching & shipping

1. While `main` is closed, nothing lands directly on it: every change enters through a pull request into `main`. The owner can open `main` with the project switch `.rsc/.no-trunk-guard`; while it is present, changes may be committed directly to `main`. _Verified: PRs #3, #4 and #5 were merged this way; `main` was unlocked on 2026-11-22 (`.rsc/.no-trunk-guard`, commit `3c74200`)._
2. Branch names follow `<type>/<kebab-case-name>`, with type `feat`, `fix`, `chore`, `refactor`, `ci` or `wip`. _Verified from the history of `main`._
3. Pull requests merge with a merge commit, never squash or rebase, so each branch's commits stay visible. _Verified in PRs #3, #4 and #5._
4. Every pull request body has What, Testing, Risk and How to revert sections. _Verified in the bodies of PRs #3 to #5._
5. Before merging, the backend passes type-check and tests: the `pre-push` hook enforces this on push. The frontend's lint and tests are run by hand until a check exists.

_Enforcement gap: there is no CI, because the GitHub account is locked for billing. Rules 1 and 5 depend on the author until CI is back._

## 5. Security & privacy floor

Sensitive data in this app: customer personal data (name, phone, address, location), account balances and debts, user passwords and JWT sessions, and WhatsApp instance credentials.

1. Secrets never enter git. `.env` is ignored in `leader-egg-back/` and `leader-egg-front/`; only `.env.example` is tracked. _Verified: back ignores `.env` and does not track it; front ignore rule added in the frontend move._
2. Passwords are stored only as bcrypt hashes (cost 10). No API response includes a password or a hash. _Verified: bcrypt hashing in `leader-egg-back/src/modules/auth/service.ts`. The "no response includes a hash" part is not yet checked by a test._
3. Every route that reads or writes customer, account, order or user data requires an authenticated session and resolves the tenant before touching data. _Verified: auth middleware in `leader-egg-back/src/modules/auth/middleware.ts` and scoped models in `leader-egg-back/src/tenancy/`._
4. The WhatsApp webhook accepts a request only with the shared secret header, and checks it before reading any data. _Verified: `leader-egg-back/src/modules/whatsapp/controller.ts`._
5. Personal data (phone, address, location) is not written to logs. _Verified only by a search for `console.log` calls with those fields; no logger audit yet._
6. No dependency with a known high-severity vulnerability is merged: `npm audit --audit-level=high` is clean in both packages. _Not run yet._

_Enforcement gap: no CI exists, so rules 1, 2, 5 and 6 are checked by review and by hand until a check is added (see the pre-push hook for the backend only)._

## 6. UX / accessibility floor (if there is a UI)

Target: WCAG 2.2 level AA. _Confirmed by the owner._

1. The document language is Spanish: `<html lang="es">` in `leader-egg-front/index.html`. _Verified._
2. Every image has an `alt` attribute. _Verified by search: no `<img>` without `alt` in `leader-egg-front/src`._
3. Every interactive control has an accessible name, from visible text or `aria-label`. _Partly verified: 86 `aria-label` uses; not enforced by any tool._
4. Focus stays visible: no `outline: none` without a replacement focus style. _Verified by search: none found._
5. Components that animate respect `prefers-reduced-motion`. _Partly verified: handled in some components only; the rest are not checked._

_Enforcement gap: no accessibility lint exists (`eslint-plugin-jsx-a11y` is not installed). Rules 2 to 5 are checked by search and review until it is added._

## 7. Performance budgets (where they matter)

Measured with `npm run build` in `leader-egg-front/`, then `gzip -c` on each file under `dist/assets/`. Units: KiB = 1024 bytes.

1. The entry JavaScript chunk (`dist/assets/index-*.js`) is at most **180 KiB gzip** (184,320 bytes). _Measured at this commit: 180,498 bytes gzip, which is 176.3 KiB, so the margin is 3.7 KiB. The budget does not grow without an amendment._
2. Lazy page chunks have no budget yet. _Measured: the largest page chunk is `NewOrderPage`, 12.2 KiB gzip. The `platform` chunk is 142.3 KiB gzip and is the one to watch._
3. Performance outside the bundle (load time, Core Web Vitals) has no budget yet. _Gap: not measured, so there is nothing to enforce._

_Enforcement gap: no CI, so rule 1 is checked by running the build by hand. It should be measured the same way each time, with the same `gzip -c` command, because gzip levels can change the size slightly._

## 8. Knowledge & decisions

1. Every significant decision is appended to `02-DOCS/wiki/harness/decisions.md` with the date, the options considered and the reason. _Verified: the log holds the monorepo layout, the local CI choice, the `.env` rule, the kebab-case rename and the merge-commit rule._
2. The constitution is indexed in `02-DOCS/wiki/index.md`, under the `sdd/` topic. _Verified: `index.md` exists and lists it._
3. Every amendment to this constitution is recorded in the amendment log at the end of this file, with date, version and reason. _Verified: the log exists and has the draft entry._
4. Every merged pull request records what changed, how it was tested and how to revert it, in its description (see section 4, rule 4). _Verified in PRs #3 to #5._

_Enforcement gap: no tool checks rules 1 and 2. They are checked by review until the harness does._

## Definition of Done (the merge bar `verify` runs against)

_Pending — to be completed in the `constitution` phase._

## Amendment log (append-only)

| Date | Version | Change | Why |
|------|---------|--------|-----|
| 2026-11-21 | draft | Draft generated by `rsc onboard`. | The SDD floor needs a constitution; ratification is the `constitution` phase's. |
| 2026-11-22 | v1.0.0 | Ratified. Sections 1 to 8 written and confirmed by the owner, one at a time: stack, quality bar, conventions, branching, security, accessibility (WCAG 2.2 AA), performance budget (entry chunk 180 KiB gzip), knowledge and decisions. `REVIEW.md` ratified with it. | First ratification, requested explicitly by the owner. |
| 2026-11-22 | v1.1.0 | Section 4, rule 1: direct commits to `main` allowed while the `.rsc/.no-trunk-guard` switch is present. | The owner asked to unlock `main` for this project. |
