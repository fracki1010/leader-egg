# SDD decisions (append-only)

## 2026-11-23 — Scope of the WhatsApp agent: team only

- **Options:** (a) customers and team; (b) only linked team users; (c) any sender with a registered phone.
- **Chosen:** (b). The owner confirmed it.
- **Why:** the assistant can write orders and payments. Only people the owner trusts should reach it.
- **Permissions:** each team member keeps the permissions the owner gives in the panel. Writes are checked again at confirmation.
- **Money:** payments and charges need a confirmation in the same WhatsApp chat before they are written. The owner confirmed it.
- **Source:** `02-DOCS/wiki/sdd/specs/whatsapp-agent-turn.md`.
- **Open:** how a confirmation is given, what an unlinked number receives, and the validity window. Listed as points to clarify in the spec.

## 2026-11-23 — WhatsApp agent spec revised and approved

- **Decision:** scope now covers text, voice notes, locations and voice confirmations; images stay out. Approved by the owner.
- **Why:** the team sends voice notes and locations, and loads customers from the field.
- **Next:** `plan` (technical approach and tasks). No code before `plan` is approved.

## 2026-11-23 — WhatsApp agent spec approved (draft points still open)

- **Decision:** the owner approved `02-DOCS/wiki/sdd/specs/whatsapp-agent-turn.md` as written.
- **Why:** the owner accepted the scope; the points to clarify stay open.
- **Next:** `clarify` resolves the 7 points, then `plan`. No code before `plan`.
