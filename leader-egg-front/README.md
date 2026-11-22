# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on build & dev performances. To add it, see [this documentation](https://react.dev/learn/compiler).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## API notes — daily closes (`/api/v1/daily-closes`)

A daily close belongs to a **channel**: `reparto` (delivery, default) or `puesto` (stall).
Each channel closes independently, so the same calendar day can have both closes. The
frontend API client (`src/api/daily-closes.ts`) threads `channel` through every read and create:

- `GET /api/v1/daily-closes/preview?date=YYYY-MM-DD&channel=puesto` — day summary for the channel without persisting.
- `POST /api/v1/daily-closes` — body `{ date?, channel?, countedCash, notes? }` (`channel` defaults to `reparto`; 409 when that channel already has a close for the date).
- `GET /api/v1/daily-closes/:date?channel=puesto` — the saved close for the day + channel (404 when none).
- `GET /api/v1/daily-closes?channel=puesto` — past closes filtered by channel.

Puesto users can only read/create `channel: 'puesto'` (the backend rejects anything else); admin/superadmin manage both. The dashboard links to `/cierre?channel=puesto` to jump straight to the stall close.
