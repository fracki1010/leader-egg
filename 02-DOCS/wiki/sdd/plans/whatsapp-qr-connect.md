---
type: plan
title: Plan — WhatsApp line linking by QR code
description: The structure-level implementation plan for linking a business's WhatsApp line by QR from Settings and removing it with its tenant — contracts, shapes, flows.
tags: [sdd, plan, whatsapp, tier-2]
timestamp: 2026-11-25T00:00:00Z
topic: sdd
slug: whatsapp-qr-connect
status: approved
---

# Plan — WhatsApp line linking by QR code

> Spec: [../specs/whatsapp-qr-connect.md](../specs/whatsapp-qr-connect.md) · Constitution: [../constitution.md](../constitution.md) · Status: draft
> Branch: `feat/whatsapp-qr-connect` (commit `4c66356`, backend already implemented there; front pending)
> Last updated: 2026-11-25

## 0. Global Constraints

- **Node:** Node.js 20 or newer. _Constitution §1.1._
- **Backend types:** TypeScript `strict`; `npm run lint` (`tsc --noEmit`) reports zero errors. _Constitution §2.2._
- **Frontend lint:** ESLint reports zero errors. _Constitution §2.3._
- **Tests:** `npm test` passes in both packages before merge. _Constitution §2.1._
- **Commits:** gitmoji plus Conventional Commits header, e.g. `🔒 fix(whatsapp): …`. No `Co-Authored-By` or AI attribution. _Constitution §3.3 and project rule._
- **Pull requests:** merge commit, never squash or rebase; body has What, Testing, Risk, How to revert. _Constitution §4.3–4.4._
- **Secrets:** the provider key and the webhook secret never appear in a response, a log line, or an error message. _Constitution §5.1, §5.5._
- **Webhook:** accepts a request only with header `x-webhook-secret`, checked before reading any data. _Constitution §5.4._
- **Personal data:** the phone number and QR payload are not written to logs. _Constitution §5.5._
- **Access:** settings routes require `authenticate`, then `authorize('admin')`, then `requirePermission('config.manage')`, in that order. _Spec §What the user can do; existing `settingsGuard` in `routes.ts`._
- **Provider timeout:** 15000 ms per call (`EVOLUTION_TIMEOUT_MS`). The creation lease is 60000 ms (`CREATE_LEASE_MS`). The timeout must stay below the lease.
- **Error bodies:** fixed messages only (`MESSAGES` in `evolution-client.ts`): "WhatsApp provider is unreachable", "WhatsApp provider rejected the credentials", "WhatsApp instance not found", "WhatsApp provider is busy, try again later", "WhatsApp provider returned an error".
- **Accessibility:** WCAG 2.2 AA; the QR `<img>` has a non-empty `alt`; the status text is not conveyed by color alone. _Constitution §6._
- **Document language:** Spanish UI copy in Settings; identifiers and code comments in English. _Constitution §6.1; project copy convention._
- **Performance:** the entry JavaScript chunk stays within 184,320 bytes gzip. The QR component is loaded inside Settings, not the entry chunk. _Constitution §7.1._

## 1. Context & constraints

- Acceptance criteria that shape the design: spec §Acceptance #1 (QR shown to admin with permission), #2 (non-admin gets no QR), #3 (QR renews without action), #4 (renewal stops on leave), #5 (connected state), #6 (provider unreachable shows unavailable, no details), #7 and #8 (deleting a business removes its line, or keeps the business if the provider refuses), #9 (admin replacement keeps the line).
- Non-functional bars: a single QR request must never create two provider instances for one business (race between two admins or two tabs). Polling cadence is 5 s while the line is not open.
- Constitution rules in play: §1 stack canon (Express, Mongoose, Zod, React, TanStack Query, MUI); §2 quality bar; §3.1 backend feature layout `modules/<name>/`; §5 security floor; §6 accessibility floor.
- Out of scope (from the spec) that the design must NOT creep into: conversations with the assistant, more than one line per business, phone-number or pairing-code linking, migration of previously linked lines.
- Decisions already recorded: 2026-11-24 scope and deletion behaviour (`decisions.md`).

## 2. Architecture

```text
[ Settings screen (front) ] --HTTP, admin session--> [ Instance routes + controller (back) ]
                                                             |
                                                             v
                                                   [ Instance service (back) ]
                                                      |               |
                              master record (store)   |               | provider adapter (external)
                                                      v               v
                                 [ WhatsappInstance (master DB) ]   [ Evolution API ]
                                                      ^
                                                      | webhook events (QRCODE_UPDATED, CONNECTION_UPDATE)
                                                      |
                                 [ Webhook receiver (back) ] <--- [ Evolution API ]

[ Tenant deprovision (back) ] --> [ Instance service: delete line ] --> [ Evolution API ]
                               --> [ master record ] --> [ tenant DB drop ]
```

- **Settings screen** (internal, front) — shows the state and the QR, polls while not open, sends one connect request. Never talks to the provider.
- **Instance routes and controller** (internal, back) — guards and HTTP mapping; resolves the tenant from the session.
- **Instance service** (internal, back) — the only place that creates or connects an instance; owns the lease and the probe-before-create rule.
- **Evolution adapter** (external, back, `evolution-client.ts`) — the provider's REST API with a timeout and fixed error mapping.
- **Webhook receiver** (internal, back) — authenticates the provider's delivery and writes QR and state into the master record. Already present; only consumed here.
- **Master record** (internal store, master DB) — one `WhatsappInstance` per tenant; the single source the screen reads.
- **Tenant deprovision** (internal, back, `tenants.ts`) — deletes the line first, then the record, then the tenant database.

**Top architectural decision:** the master record is the only thing the screen reads, and the webhook is the only writer of QR and state after creation. The screen never calls the provider. Chosen because the spec requires no provider details in responses (§Behaviour error paths), and because a single writer per field makes the QR shown always the latest one the provider sent. The one creator is the connect request, guarded by the lease, so two admins cannot create two instances.

Alternative considered: the screen polls the provider through the backend on each tick. Rejected: each tick becomes a provider call, the timeout and errors reach the screen, and the QR is only as fresh as the poll.

## 3. Interfaces & contracts

```text
GET  /api/whatsapp/instance                  (settingsGuard)
  -> 200 { state: 'not_created' | 'created' | 'connecting' | 'open' | 'close' | 'unknown', qrCode: string | null }
  - invariant: qrCode is null whenever state is 'open'
  - invariant: reads the master record only; never calls the provider
  - error: 401 unauthenticated | 403 no config.manage | 404 tenant missing

POST /api/whatsapp/instance/connect          (settingsGuard)
  -> 200 { state, qrCode | null }
  -> 409 another connect holds the creation lease
  -> 503 provider not configured | unreachable | rejected credentials
  -> 429 provider busy
  -> 502 provider returned an error
  - invariant: at most one provider instance per tenant, even under concurrent calls
  - invariant: if the provider reports the instance exists, it is adopted, never created again
  - precondition: tenant resolved from the session
  - postcondition: when state is not 'open', qrCode is the latest one the provider sent, or null if none

Evolution.deleteInstance(instanceName) -> {} | 404 notFound | 503 unreachable | 503 unauthorized | 502 failed
  - invariant: 404 means "already gone" only in the tenant-deletion path
  - postcondition: on any error other than 404 the caller keeps the tenant and the record

Webhook.deliver(event: 'QRCODE_UPDATED' | 'CONNECTION_UPDATE', payload)
  - invariant: state 'open' clears qrCode and qrUpdatedAt in the same write
  - postcondition: qrCode and qrUpdatedAt are set for QRCODE_UPDATED
```

## 4. Data model & flow

**Entities**

- **WhatsappInstance** (master DB) — `tenantId` (unique, one line per business), `instanceName` (unique, immutable, `tenant-<slug>`), `state`, `qrCode`, `qrUpdatedAt`, `providerCreated` (true once the provider confirmed the instance), `leaseUntil` (creation lease), `stateUpdatedAt`, `lastEventAt`. Relationship: belongs to one Tenant.

**Primary flow** (first connect, admin opens Settings, line not created)

1. The screen asks the GET endpoint → the service reads the record → no record means `not_created`, `qrCode` null.
2. The admin clicks connect → the POST endpoint → the service upserts the record for the tenant.
3. The service takes the creation lease on the record (only if `providerCreated` is false and no live lease exists). A live lease returns 409.
4. The service probes the provider for the instance name. If it exists, it adopts it. If the provider says not found, it creates the instance with the webhook URL and secret.
5. The service marks `providerCreated` true and releases the lease.
6. The service asks the provider for the connection payload and stores the QR the provider returns.
7. The response returns the stored state and QR.
8. The screen polls GET every 5 s while not open. The provider later sends `QRCODE_UPDATED` with a new QR → the webhook overwrites the record → the next poll shows it.
9. The phone scans the QR → the provider sends `CONNECTION_UPDATE` with `open` → the webhook clears the QR → the next poll shows connected and stops polling.

- Consistency boundaries: the record write and the provider call are not one transaction. The lease, the probe-before-create and the `providerCreated` flag make a crash or a lost reply recoverable: a retry probes first and adopts.
- Migration impact: the `providerCreated` and `leaseUntil` fields are already in the master model with defaults (false and null). Existing records without them read as not created, so the first connect probes and adopts. No backfill.
- Destructive paths: deleting a tenant deletes the provider instance first, then the record, then drops the tenant database. The tenant is kept if the provider refuses.

## 5. Testing strategy

| Acceptance criterion | Level | Asserts | Fakes / mocks |
| --- | --- | --- | --- |
| #1 admin sees QR | integration (backend) | connect with admin + config.manage returns a QR and a single create call | Evolution client at the module boundary (`vi.mock`); real master DB in memory |
| #1 admin sees QR | unit (front) | the screen renders the QR `<img>` with alt text when the API returns a QR | API module stubbed; Testing Library |
| #2 non-admin no QR | integration (backend) | 403 for admin without config.manage; 401 without session | Evolution client not called (asserted) |
| #3 QR renews | unit (front) | with fake timers, a refetch happens every 5 s until open | API stubbed; fake timers |
| #3 QR renews | integration (backend) | a `QRCODE_UPDATED` delivery replaces the stored QR and GET returns it | webhook delivery built in the test; real master DB |
| #4 renewal stops on leave | unit (front) | after unmount, no further GET calls | API stubbed; fake timers |
| #5 connected | integration (backend) | `CONNECTION_UPDATE open` clears QR; GET returns `open` and null QR | real master DB |
| #5 connected | unit (front) | open state shows the connected text and no QR, no polling | API stubbed |
| #6 provider unreachable | integration (backend) | 503 with fixed message; no provider detail in body | Evolution fetch made to fail; real master DB |
| #7 delete removes line | integration (backend) | provider delete called, record gone, tenant gone | Evolution client mocked; real master DB (already in `tenant-deprovision-whatsapp.test.ts`) |
| #8 delete keeps tenant on refusal | integration (backend) | provider error keeps tenant and record (already in the same file) | Evolution client mocked to reject |
| #9 admin replaced keeps line | integration (backend, new) | after another admin takes over, GET still returns the same record | real master DB; two users in the tenant |
| Concurrency (spec §Non-functional) | integration (backend) | two concurrent connects create once; second gets 409 or adopts (already in `whatsapp-instance.test.ts`) | Evolution client mocked |

- The e2e line: none for this change. The provider is external and not reproducible in CI; the real-provider check is a manual spike (§7 risk 1).
- Must be real, not mocked: the master database (in-memory Mongo), the lease and the record writes. Mocking them would test nothing about the race or the adoption rule.

## 6. Sequencing & dependencies

1. **Verify the provider contract** (Evolution `DELETE /instance/delete/{name}` and the 404 meaning of `connectionState`) against a test instance, read-only where possible — depends on: none — [parallelizable with 2 and 3].
2. **Remove the manual regenerate button** from the Settings screen, keep the single connect action for the first create — depends on: none — [parallelizable with 1 and 3]. The screen keeps polling; renewal is left to the webhook (see §7 open decision).
3. **Front tests** for the states and the timers (criteria #1, #3, #4, #5) — depends on: #2 — [serial after 2].
4. **Backend suite green on the branch**: run `npm test` and `npm run lint` in `leader-egg-back` — depends on: none — [parallelizable with 1, 2 and 3].
5. **Backend test for admin replacement** (criterion #9) — depends on: #4 — [serial after 4].
6. **Front suite and lint green**: `npm test` and `npm run lint` in `leader-egg-front` — depends on: #3 — [serial after 3].
7. **Push the branch** and open the PR with the spec link in frontmatter (tier-2 gate) — depends on: #1, #4, #5, #6 — [serial, last].

- Parallel candidates (disjoint scope, no shared state): #1, #2, #4 (provider check, front change, backend run touch different files).
- Hard ordering constraints: #3 after #2 because the tests target the button's removal; #7 after all verification, because the push gate checks the spec and the PR must carry the test evidence.

## 7. Risks & open decisions

**Risks** (ranked, most likely/impactful first)

| Risk | Trigger | Impact | Mitigation / spike to retire it |
| --- | --- | --- | --- |
| Evolution `DELETE /instance/delete/{name}` path or its 404 meaning differs from the assumption | First real tenant deletion, or a live check in step #1 | A tenant deletion could fail every time (kept tenant, error shown) or leave a line behind if 404 means something else | Step #1 verifies the path and the 404 on a test instance before merge. If unverified, the code path stays fail-closed: the tenant is kept, so no line is orphaned silently |
| The provider stops sending `QRCODE_UPDATED` periodically, so the QR expires and the screen never renews | Provider behaviour during a long Settings session | Admin sees an expired QR and cannot link | Step #1 checks the event cadence. Open decision below decides the fallback |
| Webhook base URL misconfigured (must be the public origin without path) | Deploy with a different base URL | QR and state never update; screen stuck | Check `WHATSAPP_WEBHOOK_BASE_URL` in the target environment before release; the connect response's QR would still show the first QR only |
| Creation takes longer than the 60 s lease | Slow provider with the 15 s timeout multiplied by probe and create | A second connect could create a duplicate, or see 409 for a live create | The timeout (15 s) is below the lease; the probe-first rule adopts an instance created by the first request. Monitor 409 rate |
| Admin replacement assumed harmless but the record is tied to the admin | A future change keying the record by user | Line unlinked on admin change | Criterion #9 and its test lock the rule to the tenant |

**Open decisions** (still genuinely undecided)

- Keep a manual "new QR" fallback in Settings, or rely only on the webhook renewal — closes when step #1 shows whether the provider sends `QRCODE_UPDATED` periodically. The spec currently has no manual button, which matches criterion #3.
- The unavailable message wording for the screen (criterion #6) uses the spec's reference copy; it closes when the owner reviews the approved copy with the reference artifact.

Significant decisions taken while planning go to `02-DOCS/wiki/sdd/decisions.md` after the owner approves this plan.

## Tasks

<!-- generated by tasks on 2026-11-25; IDs are stable, do not renumber -->

| ID | [P] | Task | Done-check | Depends-on | Trace | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| T001 | [P] | Verify the provider's delete endpoint and its 404 meaning on a test instance (plan §6 step 1) | Recorded result in this section: `DELETE /instance/delete/<test-name>` returns the observed code, and `GET /instance/connectionState/<missing-name>` returns 404. Needs a test instance and key from the owner | — | AC7, AC8 | default |
| T002 | [P] | Remove the "Generar nuevo QR" button from `WhatsappSection.tsx`; keep the single connect action for the first create (plan §6 step 2) | `grep -c "Generar nuevo QR" leader-egg-front/src/components/settings/WhatsappSection.tsx` prints `0`; `cd leader-egg-front && npm run lint` exits 0 | — | AC3 | default |
| T003 | | Write front tests for the QR state, renewal, unmount and connected state (plan §6 step 3) | `cd leader-egg-front && npx vitest run src/components/settings/WhatsappSection.test.tsx` green with 4 cases: QR `<img>` has alt text; refetch every 5 s with fake timers; no GET after unmount; open state shows connected text and no QR | T002 | AC1, AC3, AC4, AC5 | default |
| T004 | [P] | Confirm the backend suite is green on the branch (plan §6 step 4) | `cd leader-egg-back && npx vitest run src/__tests__/whatsapp-instance.test.ts src/__tests__/tenant-deprovision-whatsapp.test.ts src/__tests__/whatsapp-evolution-client.test.ts` exits 0; `npm run lint` exits 0 | — | AC1, AC2, AC6, AC7, AC8 | default |
| T005 | | Add a backend test: replacing a business's admin keeps the same line connected (plan §6 step 5) | `cd leader-egg-back && npx vitest run src/__tests__/whatsapp-instance.test.ts -t "admin is replaced"` green; the test asserts GET returns the same record and state after a second admin takes over | T004 | AC9 | default |
| T006 | | Front suite and lint green (plan §6 step 6) | `cd leader-egg-front && npm test && npm run lint` both exit 0 | T003 | AC1, AC3, AC4, AC5 | default |
| T007 | | Push the branch with the spec linked, and open the PR (plan §6 step 7) | `git push -u origin feat/whatsapp-qr-connect` passes the tier-2 gate (spec status approved, `branch:` set); `gh pr view` shows What, Testing, Risk and How to revert in the body | T001, T004, T005, T006 | all | tier 2 (branch) |
| T008 | | Closer: every row above checked | Each done-check above has evidence recorded; `npm test` and `npm run lint` exit 0 in both packages | all | all ACs | — |

**Parallel-safe groups:** T001, T002 and T004 share no files and no state, so they can run together. T003 waits for T002; T005 waits for T004; T006 waits for T003.

**Per-task Interfaces** (only where a contract crosses tasks):

- **T005 — Interfaces**
  - Consumes: `GET /api/whatsapp/instance` → `{ state, qrCode }` (plan §3); `WhatsappInstance` record keyed by `tenantId` (plan §4)
  - Produces: test asserting that a tenant admin change does not alter the record or its state

**Review Workload Forecast**

| Dimension | Forecast | Why |
| --- | --- | --- |
| Estimated changed lines | about 200 (front: under 40 lines changed; tests: about 150; backend test: about 30) | the backend implementation already exists on `4c66356` |
| Files / areas | 3 areas: `leader-egg-front/src/components/settings/`, `leader-egg-back/src/__tests__/`, `02-DOCS/wiki/sdd/` | Settings UI, whatsapp tests, spec and plan |
| Risk | `rsc risk` reports `default` for every expected path. The branch itself is tier 2 at the push gate (auth, secrets, harness), so the PR needs a spec linked | the tier comes from the tool, not from judgement |
| Suggested delivery | `single-pr` | under the 400-line budget |

_Generated by `tasks` on 2026-11-25. Tier forecast from `npx @ericrisco/rsc risk` on the expected paths._
