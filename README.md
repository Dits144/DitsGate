# DitsGate — frontend demo

Standalone React + TypeScript + Vite prototype. Everything in this folder is independent of `DitsGate-tools`.

## Run

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5179/. The public dashboard routes in this prototype are original interpretations of the product brief; the reference dashboard itself is behind a login.

## Verify

```sh
npm run typecheck
npm run test
npm run build
npx playwright test
```

Playwright menjalankan pemeriksaan 20 rute serta simulasi pembayaran pada desktop (1440px) dan mobile (390px). Jalankan `npx playwright install chromium` sekali bila browser belum terpasang.

## Demo scope

Landing, login/register/forgot mock screens, `/docs` and `/integrations`, merchant dashboard and sidebar modules, an explicitly unauthenticated admin simulation, and `/pay/:id` checkout preview. Create a payment from the dashboard to exercise the transaction list and checkout. Search, filters, CSV export, simulated admin status changes, preferences, bank records, provider settings, QRIS image and demo state use browser-local storage (`ditsgate_demo_v1`). The QRIS image is a local data URL; use a small image to avoid browser storage limits. Clearing site storage resets the demo.

**This is not a payment product.** No real authentication, payment verification, provider connection, banking transfer, email reset, API credential, or webhook delivery occurs. Password forms are UI illustrations and are not persisted. Do not enter a real password or real financial/customer information. The sample API endpoint uses `.invalid` and cannot be called.
