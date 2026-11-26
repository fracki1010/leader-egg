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

## 2026-11-24 — WhatsApp line linking by QR: scope and deletion

- **Decision:** the spec `02-DOCS/wiki/sdd/specs/whatsapp-qr-connect.md` is approved by the owner. Only admins link the line or see the QR code, from Settings. The QR renews by itself while Settings is open and stops when the screen closes.
- **Decision:** deleting a business removes its WhatsApp line at the provider first. If the provider cannot remove it, the business is kept.
- **Why:** a line left linked to a deleted business is invisible from the app. The owner authorised the deletion behaviour in chat on 2026-11-24.
- **Source:** `02-DOCS/wiki/sdd/specs/whatsapp-qr-connect.md`.
- **Open:** none blocking. The provider's delete endpoint and its 404 meaning are unverified against a live Evolution.
