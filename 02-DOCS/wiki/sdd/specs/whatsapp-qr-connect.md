---
type: spec
title: Spec — WhatsApp line linking by QR code
description: Lets an admin link the team's WhatsApp line from Settings by scanning a QR code, and removes that line when its tenant is deleted.
tags: [sdd, spec, whatsapp, tier-2]
topic: sdd
slug: whatsapp-qr-connect
timestamp: 2026-11-24T00:00:00Z
branch: feat/whatsapp-qr-connect
status: approved
---

# Spec — WhatsApp line linking by QR code

> Slug: `whatsapp-qr-connect` · Status: approved by the owner on 2026-11-24 · Created: 2026-11-24
> Inherits: [constitution](../constitution.md)
> Separate from [whatsapp-agent-turn](whatsapp-agent-turn.md): that spec covers conversations with the assistant; this one covers linking the line itself.

## Problem & why

The assistant can only receive WhatsApp messages once the business's WhatsApp line is linked to the platform. Today linking has no screen: an operator would have to do it in the provider's own panel, outside the app. The admin of a business needs to link the line from Settings, in the app they already use, and to see whether the line is connected.

## Cost of not building it

Every business that wants the WhatsApp assistant depends on someone with access to the provider's panel. Linking is delayed, and a mistake there (a line linked to the wrong tenant, or left behind after a tenant is deleted) is not visible from the app.

## The cheapest alternative

The operator links the line from the provider's own panel and tells the platform nothing. It works without new code, and no screen is needed. It does not solve the problem: the admin cannot see the connection state from the app, and a deleted tenant leaves its line behind in the provider.

## Goals

- An admin of a business can link the business's WhatsApp line by scanning a QR code shown in Settings.
- The admin can see whether the line is connected, without leaving the app.
- When a business is deleted, its WhatsApp line is removed with it, so no line stays linked to a business that no longer exists.

## Non-goals / out of scope

- Conversations with the assistant over WhatsApp (covered by [whatsapp-agent-turn](whatsapp-agent-turn.md)).
- Linking more than one line per business.
- Any screen for users who are not admins, beyond what is needed to see that the feature exists.
- Linking by phone number or pairing code. Only the QR code is in scope.
- Migrating lines that were linked before this feature, outside the app.

## Users & context

An admin of a business who uses the app from a computer in the office and has the team's WhatsApp line on their phone.

## What the user can do

- An admin, signed in, opens Settings and asks to link the WhatsApp line. The admin then scans the QR code with the phone that holds the line.
- A signed-in user who is not an admin cannot link the line and cannot see the QR code.
- Scanning the code while the line is already connected is not needed: the screen shows that it is connected.

## What result they get

- While the line is not connected, Settings shows a QR code. When the admin scans it with the phone, the screen changes to show that the line is connected.
- The QR code renews by itself while the Settings screen stays open, so an expired code never has to be requested by hand. Renewal stops once the line is connected.
- Visual reference: the two states (waiting for scan, connected) are approved by the owner on 2026-11-24 as the reference, published at https://claude.ai/artifact/Qrojfp8qZeunJtNoRKtRuh. The Settings screen must match it.

## What it must respect

- Only admins with permission to manage the business configuration can link or see the QR code. This matches the existing configuration screens.
- One WhatsApp line per business, as already stated in the data model.
- Deleting a business must not leave its line linked, as recorded in the decisions log for this change.
- A line must never be linked to a business other than the one the admin is signed into.
- The line belongs to the business, not to an admin: replacing a business's admin does not unlink or reset the line.

## How it proves it

- For each acceptance criterion, an automated check runs against the feature and its result is kept with the change's verification record.
- The approved visual reference is compared with the Settings screen by a human, and the decision is recorded.

## Behaviour

- Main path: the admin opens Settings, the screen asks the provider for a QR code for the business's line, the code is shown. When it is scanned, the screen shows the line as connected.
- Edge cases: the code expires before it is scanned, so a new one is shown without the admin doing anything. The admin leaves Settings, so renewal stops. The line is already connected, so the screen shows that and no code.
- Error paths: the provider cannot be reached, so the screen says the line cannot be linked right now and offers to try again. A user who is not an admin gets no code and no way to request one. Errors never show provider details or credentials.
- Deleting a business: its line is removed from the provider first. If the provider cannot remove it, the business is kept, so the line is not left behind without its record.

## Acceptance criteria

- Given an admin with permission to manage the business configuration, When they open Settings and the line is not connected, Then a QR code is shown.
- Given a signed-in user without that permission, When they open Settings, Then no QR code is shown and they cannot request one.
- Given a QR code on screen, When the code expires, Then a new code replaces it without any action from the admin.
- Given the admin leaves Settings, When the screen closes, Then code renewal stops.
- Given the line is scanned and connected, When the screen updates, Then it shows the line as connected and no longer shows a code.
- Given the provider cannot be reached, When the admin asks for a code, Then the screen shows that linking is unavailable, and no provider details are shown.
- Given a business with a linked line, When the business is deleted and the provider removes the line, Then the line's record is removed with the business.
- Given a business with a linked line, When the business is deleted and the provider cannot remove the line, Then the business is kept and an error is shown.
- Given a business with a linked line, When its admin is replaced by another admin, Then the line stays connected and no new QR is required.

## Points to clarify

- **suposición tomada** — (validada el 2026-11-24) el proveedor entrega el código QR y avisa cuando la línea cambia de estado. *Validación:* la instalación de la instancia suscribe los eventos `QRCODE_UPDATED` y `CONNECTION_UPDATE` (`leader-egg-back/src/modules/whatsapp/evolution-client.ts`), y el servicio de webhooks guarda el QR y el estado en cada evento (`leader-egg-back/src/modules/whatsapp/webhook-service.ts`). *Riesgo residual:* si el proveedor dejara de avisar, el estado quedaría desfasado; el criterio no cambia.

## Clarifications

- **2026-11-24 — ¿Qué pasa con la línea cuando el negocio cambia de administrador?** → Nada. La línea pertenece al negocio, no al admin. *Base:* el registro de la línea tiene `tenantId` único (`leader-egg-back/src/tenancy/master-models.ts`), y cualquier admin del negocio ve la misma línea. Se agrega como criterio de aceptación y como requisito de *What it must respect*. Esta pregunta era un área no formulable; al precisarla, ya no cambia lo que se construye.
- **2026-11-24 — Suposición del proveedor (QR y estado).** → Validada, ver arriba. No cambia el criterio.
- **2026-11-24 — Registro de la decisión de borrado.** La spec citaba un registro de decisiones que no existía. Se agrega en `02-DOCS/wiki/sdd/decisions.md`: borrar el negocio borra su línea en el proveedor, y si el proveedor no la puede borrar, el negocio se conserva. Lo autorizó el dueño en el chat.
