---
type: plan
title: Plan — WhatsApp agent turn (slice c)
description: Technical blueprint for connecting inbound WhatsApp messages to the assistant, with text, audio, location and confirmations.
tags: [sdd, plan, whatsapp, agent]
topic: sdd
status: draft, awaiting human review
spec: 02-DOCS/wiki/sdd/specs/whatsapp-agent-turn.md
date: 2026-11-23
---

# Plan — WhatsApp agent turn (slice c)

The spec (`approved`, 2026-11-23) says what the team gets. This plan says how.

**Human review required before merge.** This change touches `leader-egg-back/src/modules/whatsapp/`, and `REVIEW.md` lists that path as always-human. It also touches the agent's write actions, which are part of the authorization model.

## 0. Global constraints

These values hold in every task. A task that breaks one of them is wrong.

- A team member's request is only ever answered with data from their own tenant.
- Only numbers linked to a user are processed. Any other number gets no reply and no data is read.
- Every write goes through prepare → confirm. Nothing is written by a message alone.
- Permissions are checked when an action is prepared and again when it is confirmed.
- A confirmation ("sí" or "no") applies only to a pending action of the same user, and only before it expires (30 minutes, `ACTION_TTL_MS` in `agent/actions.ts`).
- Images get the fixed reply "tipo de mensaje no soportado" and nothing else.
- The webhook's shared-secret check runs before any message content is read (already in place; do not move it).

## 1. Context & constraints

- Spec, decisions log: `02-DOCS/wiki/sdd/specs/whatsapp-agent-turn.md`, `02-DOCS/wiki/sdd/decisions.md`.
- Constitution §5 (security floor), §2 (quality bar: tests pass, `tsc --noEmit` clean), §3 (kebab-case files, one folder per module).
- Existing code that this plan builds on:
  - `whatsapp/webhook-service.ts`: `parseDelivery`, `isStatusEvent`, `applyStatusEvent`. Validates the instance.
  - `whatsapp/queue.ts`: `enqueue(key, task)` and `waitForIdle()`. Serializes tasks by key.
  - `whatsapp/turn.ts`: `runWhatsappTurn(input)`, an empty stub. **It has no callers.** The webhook does not invoke it yet.
  - `whatsapp/evolution-client.ts`: `sendText`, `getBase64FromMedia`.
  - `whatsapp/groq-client.ts`: `postJson` only. Transcription is not implemented ("added with the media slice").
  - `agent/service.ts`: `chat(userId, userName, permissions, message)`.
  - `agent/actions.ts`: `prepare*Action`, `getAction`, `cancelAction`, `confirmAction(userId, role, permissions, actionId)`. Pending actions carry `expiresAt`. A user can have several pending at once.
  - `customers/model.ts`: `location` is GeoJSON `[lng, lat]` with a 2dsphere index.

## 2. Architecture

```text
Evolution ──webhook──▶ whatsapp/controller ──▶ webhook-service (secret, instance, parse)
                                                     │ text / audio / location / image
                                                     ▼
                                            queue.enqueue(userId)   [serializes per user]
                                                     │
                                                     ▼
                                            turn.runWhatsappTurn  ◀── the seam (this plan)
                                              │        │        │
                              audio ─────────┘        │        └──── image → fixed reply
                       (fetch media → transcribe)     │
                                                      ▼
                                      confirmation? ── yes ──▶ agent: confirmAction(latest pending)
                                              │ no
                                              ▼
                                      agent: chat(...) or prepare location update
                                              │
                                              ▼
                                      evolution.sendText(reply)  ──▶ team member
```

Single responsibility per component:

- **turn** (`whatsapp/turn.ts`): orchestrates one inbound message. Decides the path.
- **media** (new, `whatsapp/media.ts`): fetches an audio message's bytes from the provider.
- **transcribe** (new method on `groq-client.ts`): audio bytes → text.
- **confirmation** (new, `whatsapp/confirmation.ts`): recognises "sí"/"no" and finds the user's latest pending action.
- **location action** (new action type in `agent/actions.ts`): prepares and confirms "set customer location".
- **reply** (uses `evolution-client.sendText`): every outbound message.

**The one decision that matters most: asynchronous processing, serialized per user.**

Why: a transcription can take seconds and the webhook must answer quickly. The queue already exists. Serializing per user means that "sí" can never be processed before the action it confirms.

Alternatives considered:
- *Synchronous processing inside the webhook.* Simpler, but the provider times out on slow transcriptions, and the webhook retries duplicate messages. Rejected.
- *A separate worker process.* Stronger isolation, but a new deployable for a team of one. Rejected for now; revisit if the queue stops fitting in memory.

Recommendation: the in-process queue, keyed by user.

## 3. Interfaces & contracts

```text
turn.runWhatsappTurn(input: WhatsappTurnInput): Promise<void>
  - input.kind ∈ {text, audio, location, image}
  - always resolves; failures become a short reply, never a thrown error to the webhook
  - replies through evolution.sendText to input.replyJid

media.fetchAudio(instanceName, messageKey): Promise<Buffer>
  - uses evolution.getBase64FromMedia
  - rejects if the media is missing or larger than the configured limit

groq.transcribe(audio: Buffer, mime: string): Promise<string>        [new]
  - returns the text, or throws a typed TranscriptionError
  - timeout GROQ_TIMEOUT_MS (already defined)

confirmation.resolve(userId, text): ConfirmationResult
  - "sí" | "no" (case and accents ignored; trailing punctuation ignored)
  - finds the most recent pending, unexpired action of the user
  - no pending action → "not a confirmation" (the text goes to the assistant as a normal message)
  - more than one pending action → asks which one, and confirms nothing

agent.prepareLocationAction(ctx, { customerName, location }): PreparedActionResponse   [new]
  - resolves the customer by name inside the caller's tenant
  - zero matches or several matches → returns a question, prepares nothing
  - re-checks the permission used by customer edits (customers.manage)
  - stores a pending action with the server-built payload

agent.confirmAction(...)   unchanged signature; used for the confirmation path
```

Error contract: every path above ends in exactly one reply to the team member, or in silence when the sender is not linked.

## 4. Data model & flow

- **Pending actions:** existing `agent_pending_actions` collection. One new value in the action-type enum: `set_customer_location`. Adding an enum value needs no migration; existing documents are unaffected.
- **Customer location:** existing `location` field. No schema change.
- **Idempotency:** the webhook can deliver the same message twice. The provider message id (`providerMessageId`) is recorded per message, and a duplicate is ignored. The `whatsapp` module already stores inbound messages; this relies on that record.
- **Flow for a text message:** webhook → queue (user) → confirmation check → if not a confirmation, agent chat → reply.
- **Flow for a voice note:** webhook → queue → fetch media → transcribe → same as a text message from there on.
- **Flow for a location:** webhook → queue → resolve customer name from the same chat's text, if provided → prepare `set_customer_location` → reply with the summary → on confirm, write `location` on that customer.

Open implementation detail, decided here: the customer name comes from the text of the same message, so a location sent with no name gets the question "¿a qué cliente?" and prepares nothing.

## 5. Testing strategy

Per acceptance criterion in the spec:

| Criterion | Level | What it asserts | What it fakes |
| --- | --- | --- | --- |
| Prepare payment; nothing written | integration | Summary returned; `payments` collection unchanged | Evolution client (records sent text) |
| Confirm within window → recorded | integration | Payment written; reply confirms | Evolution client |
| Cancel → nothing recorded | integration | No write; reply confirms cancel | Evolution client |
| Expired → refused | unit + integration | `expiresAt` in the past refuses | Clock |
| Permission removed before confirm | integration | Refused; reason in reply | Permission set changed mid-test |
| Unlinked number → silence | unit | No reply sent; no data read | Evolution client |
| Voice note, clear request | integration | Same result as the typed request | Groq transcribe returns fixed text |
| Voice confirmation "sí" | unit | Confirms the pending action | Groq transcribe returns "sí" |
| Voice confirmation other text | unit | Nothing confirmed; asks again | Groq transcribe returns "tal vez" |
| Location with customer named | integration | Prepared update; written only on confirm | Evolution client |
| Location, customer ambiguous | unit | Question returned; nothing prepared | Customer search returns two |
| Image → fixed reply | unit | Fixed text; nothing read | — |
| Tenant A never sees tenant B | integration | Order list has only tenant A's orders | Two tenants with data |
| Webhook without secret → refused | existing test | Already in `whatsapp-webhook.test.ts`; keep it green | — |

Tooling is the stack skill's choice: Vitest, Supertest and `mongodb-memory-server` are already in the project (`constitution` §1).

## 6. Sequencing & dependencies

Build in this order. Each step is independently verifiable and leaves the system working.

1. **Wire the seam.** Webhook calls `turn.runWhatsappTurn` for text, through the queue keyed by user. Reply is silence for unlinked numbers. Nothing else changes.
2. **Reply path.** `runWhatsappTurn` answers text with the agent's reply through `sendText`.
3. **Confirmation.** "sí"/"no" resolve the user's latest pending action. Ambiguous cases ask which one.
4. **Audio.** Media fetch, then `groq.transcribe`, then the text path. Transcription error → short reply.
5. **Location action.** New action type, prepare with name resolution, confirm writes `location`.
6. **Images and tenant tests.** Fixed reply; tenant isolation test.

Steps 1–3 depend on nothing new. Step 4 needs the Groq method. Step 5 needs the agent action type. Step 6 is last so it covers the full path.

## 7. Risks & open decisions

Ranked by likelihood × impact.

1. **The seam has no caller (high).** `runWhatsappTurn` is never invoked, and the webhook does not call it today. Trigger: any test of the end-to-end path. Mitigation: step 1 proves the wiring first, with a test that fails if the call is removed.
2. **Transcription quality and format (high).** Evolution returns base64 media; the Groq multipart request is not implemented. Trigger: an unusual audio format or a noisy note. Mitigation: a spike on a real voice note before step 4 is merged, recorded in the verification file. Confirmations by voice require an exact "sí"/"no" match, so a bad transcription is rejected, not executed.
3. **Several pending actions per user (medium).** The data model allows it, and the spec's "sí applies to the pending action" is ambiguous with more than one. Mitigation: `confirmation.resolve` asks which one and confirms nothing. Decision recorded here, to be validated by the owner.
4. **Duplicate deliveries (medium).** Trigger: provider retry. Mitigation: duplicate `providerMessageId` ignored. Relies on the existing inbound record; verify it exists before step 1.
5. **Location name ambiguity (medium).** Two customers with the same name. Mitigation: the question path in §3; never guess.
6. **Always-human paths (governance).** `whatsapp/`, `auth/` (the permission re-check) and `tenancy/` require human review per `REVIEW.md`. Mitigation: the PR is held for a human reviewer before merge.
7. **Rate of agent calls per user (low).** `chat` already limits messages per hour. Mitigation: reuse that limit; do not add a second one.

Open decisions, none blocking the start of step 1:
- Whether a voice note's transcription is shown to the team member before it is acted on. Default in this plan: no, it is acted on, and the summary of the prepared action shows what was understood.

## Isolation

Not chosen yet. Proposed before implementation: a dedicated branch or worktree for this change, since `main` is open for direct commits and this change is large.
