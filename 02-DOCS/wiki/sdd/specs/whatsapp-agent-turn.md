---
type: spec
title: Spec — WhatsApp agent turn (slice c)
description: Lets the team talk to the assistant over WhatsApp, with the same permissions and confirmation rules as the app.
tags: [sdd, spec, whatsapp, agent]
topic: sdd
status: approved
date: 2026-11-23
---

# Spec — WhatsApp agent turn (slice c)

Status: **approved by the owner on 2026-11-23** (revised scope: text, voice notes, locations and voice confirmations). The open points below do not block `plan`. No implementation before `plan` is approved.

## Problem & why

The team runs the business from the app. The assistant in the app can create orders, record payments and change order status, but only on a screen. When someone is out of the office, nothing can be done from the phone they already use every day. The WhatsApp channel already receives messages and checks the sender, but it does not answer. An accepted message gets no reply and no action.

## Cost of not building it

Each request that needs the assistant waits until someone is back at a computer. Payments and orders are recorded late, and the team keeps a second channel (their own messages, paper notes) to remember what happened. The cost is delay and double entry, paid every working day.

## The cheapest alternative

Open the app on a phone and use the existing assistant there. This works today and needs no new work. It does not solve the problem for the team: the app needs a session and a screen, and it cannot receive a message from a client or a supplier that the team forwards. It is the fallback if this spec is not approved.

## Goals

- A team member can ask the assistant for information and make changes by sending a WhatsApp message, with the same results they would get in the app.
- A money movement (a payment, a charge) is never recorded from WhatsApp until the team member confirms it in the same chat.
- Only numbers linked to a team user can reach the assistant.

## Non-goals / out of scope

- Messages from numbers that are not linked to a user, including customers. They get no answer from the assistant.
- Group chats and conversations with more than one person.
- Images. They get a fixed reply that says the message type is not supported.
- Changes to the assistant's behaviour in the app.
- Creating or linking WhatsApp users. The owner does that from the panel.
- Anything the team could add "just in case": proactive messages from the assistant, scheduled reports, read receipts.

## Users & context

- **Team member.** A user of the app, with their phone linked in the panel, who is away from a computer. Each team member has the permissions the owner gave them in the panel.
- **Owner.** Links phones to users and sets permissions in the panel. Not a WhatsApp user in this spec.

## What the user can do

A team member, with a phone linked to their account, sends a text message to the business number. The assistant answers in the same chat and can prepare any action their permissions allow. Preparing an action changes nothing. The team member confirms it in the chat before it is written.

## What result they get

- A text answer in the same WhatsApp chat.
- For a prepared action, a short text summary of what will happen (for example: "Register a payment of $12.000 from customer X, order Y"), and a way to confirm or cancel it in the chat.
- After a confirmation, a text reply with the result, or with the reason it was refused.

## What it must respect

- The app's permission model: each action checks the user's permissions when it is confirmed, not only when it is prepared.
- The app's confirmation rule for writes: nothing is written until a person confirms the prepared action.
- Tenant isolation: a message is only ever answered with data from the tenant the sender belongs to.
- The WhatsApp webhook's shared-secret check runs before any message is read.
- The payload of a prepared action is produced by the server. The chat never supplies it.

## How it proves it

- Automated tests for each acceptance criterion below, run in the backend test suite.
- The test run output and the list of acceptance criteria with their results are kept with the change.
- A manual check on a real phone with a test team user, once, before merge. Recorded in the pull request.

## Behaviour

Main path:
1. A message arrives on the business number from a linked team user.
2. The assistant reads the text and answers in the same chat.
3. If the request is an action, the assistant prepares it and sends a summary.
4. The team member replies to confirm or cancel.
5. On confirm, the action is checked against the user's permissions and written. The result is sent back in the chat.

Edge paths:
- A message with an unsupported type (image) gets a fixed reply that says so. Nothing is read or written.
- A voice note is handled as the text it contains. A location is handled as described in Points to clarify.
- A confirmation that arrives after the prepared action has expired is refused, with a reply that says it expired.
- A confirmation from a different chat than the one that prepared the action is refused.

Error paths:
- A message from a number not linked to any user gets no assistant answer (see Points to clarify).
- If the user lost a permission between preparing and confirming, the action is refused and the reply says why.
- If the assistant fails, the team member gets a short failure reply and nothing is written.

## Acceptance criteria

- Given a number linked to a user with permission to register payments, When the user sends "register a payment of $100 for order X", Then the assistant replies with a summary and nothing is written yet.
- Given a prepared payment, When the user confirms in the same chat within the validity window, Then the payment is recorded and the reply confirms it.
- Given a prepared payment, When the user cancels, Then nothing is recorded and the reply confirms the cancellation.
- Given a prepared payment older than the validity window, When the user confirms, Then nothing is recorded and the reply says it expired.
- Given a user whose permission to register payments was removed after the action was prepared, When the user confirms, Then nothing is recorded and the reply says the permission is missing.
- Given a message from a number not linked to any user, When it arrives, Then no assistant answer is sent and no data is read or written.
- Given a voice note from a linked user with a clear request, When it arrives, Then the assistant handles it as if the user had typed the same request, and the reply is a summary or an answer in text.
- Given a prepared action in a chat, When the user sends a voice note whose transcription is exactly "yes" or "no" (in Spanish: "sí" or "no"), Then the action is confirmed or cancelled as if it had been typed.
- Given a prepared action in a chat, When the user sends a voice note whose transcription is anything else, Then nothing is confirmed or cancelled, nothing is written, and the assistant asks again.
- Given a location sent by a linked user and a customer named in the same chat, When the user sends it, Then the assistant prepares an update of that customer's location, and nothing is written until the user confirms.
- Given an image from a linked user, When it arrives, Then the reply says the message type is not supported and nothing is read or written.
- Given a linked user of tenant A, When they ask for a list of orders, Then the reply contains only tenant A's orders.
- Given a webhook call without the shared secret, When it arrives, Then it is refused before any message content is read.

## Points to clarify

- **resuelta** — la confirmación es "sí" o "no" en la misma conversación, decidido por el dueño el 2026-11-23. Una respuesta "sí" o "no" solo aplica a la acción pendiente de ese mismo chat. Si no hay ninguna pendiente, el asistente responde que no hay nada que confirmar.
- **resuelta** — un número no vinculado no recibe respuesta del asistente: silencio, decidido por el dueño el 2026-11-23. Así no se revela a quién le responde el asistente.
- **resuelta** — la ventana de validez de una confirmación por WhatsApp es de 30 minutos, igual que en la app, decidido por el dueño el 2026-11-23.
- **resuelta** — se procesan textos, audios y ubicaciones; las imágenes reciben una respuesta fija. Decidido por el dueño el 2026-11-23. Cambia el alcance aprobado: requiere nueva aprobación.
- **resuelta** — una ubicación enviada por el equipo sirve para cargar la ubicación de un cliente. Decidido por el dueño el 2026-11-23. Su "o algo" queda como pregunta abierta de abajo.
- **resuelta** — el cliente al que se guarda la ubicación es el que el usuario nombra en su mensaje. Decidido por el dueño el 2026-11-23.
- **suposición tomada** — guardar una ubicación en un cliente es una escritura, así que pasa por la misma preparación y confirmación que cualquier otra acción. *Base:* la regla de escritura de la app, que exige confirmación. *Riesgo:* si el equipo quiere que la ubicación se guarde sin confirmar, habrá que cambiar este punto.
- **resuelta** — una confirmación ("sí" o "no") puede enviarse como audio. Decidido por el dueño el 2026-11-23.
- **suposición tomada** — un audio de confirmación cuenta solo si su transcripción es exactamente "sí" o "no". *Base:* evitar confirmar algo por una frase ambigua. *Riesgo:* la transcripción puede equivocarse; un "sí" mal transcrito se rechaza y el asistente vuelve a preguntar, sin escribir nada.
- **decisión diferida** — chats grupales y varios números por usuario. Fuera de este ciclo.
- **área no formulable** — cómo se mide que el asistente entiende bien los pedidos escritos informalmente por el equipo. Todavía no sé enunciarlo con precisión.
- **suposición tomada** — el borrador no ha sido revisado por un revisor humano. *Base:* `REVIEW.md` marca `whatsapp/` como ruta de revisión humana obligatoria. *Riesgo:* ninguno mientras no se implemente; la revisión ocurre antes del merge.

## Risks and gaps in the harness

- `02-DOCS/wiki/sdd/config.yaml` no existe. Según la skill `specify`, conviene correr `sdd-init` antes de implementar. No bloquea este borrador.
