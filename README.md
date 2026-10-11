# Lead-Agent- (Andi)

Andi is an AI lead qualification chat plus a rep dashboard for a single window replacement sales rep in the Baton Rouge area. See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the business background.

## What's here

| Path | What it is |
|---|---|
| `public/index.html` | Homeowner landing page with the Andi chat |
| `public/dashboard.html` | Rep dashboard: KPIs vs. monthly targets, lead list, appointment detail |
| `public/js/core.js` | Lead record, territory check, scoring, storage (shared) |
| `public/js/andi.js` | Chat state machine |
| `public/js/dashboard.js` | Dashboard UI |
| `netlify/functions/andi.mjs` | `/api/andi`: Claude proxy (API key stays server-side) |
| `netlify/functions/lead.mjs` | `/api/lead`: HMAC-signed forward to the n8n intake webhook |
| `tests/` | Unit tests (`npm test`) |

## How a lead flows

1. The homeowner answers Andi's questions: pain points, window count, doors, window age, frame material, home type, ownership and timeline.
2. Andi collects contact details, checks the ZIP against the territory and offers consultation slots.
3. The lead is scored 0–100 (hot 70+, warm 45+, cold) with the reasons shown to the rep.
4. The lead is saved in the browser and posted to `/api/lead`. That function signs it and sends it to n8n Workflow 1, which handles the 60-second SMS and the Sheets log.

The lead record mirrors the fields on the rep's CRM appointment card: Appointment Type, Set Date, Address, Primary Contact, Property Type, Lead Source, Source Breakdown, Details ("6 Units (6 Windows +0 Doors)"), Age of Windows, Windows Material, Year Built and Project Details. The dashboard's **Copy for CRM** button copies those fields as text for pasting into the portal.

Off-script messages, such as questions about price, go to Claude through `/api/andi`. Only two fixed tasks are accepted, and all prompts are built on the server. Without an API key, Andi falls back to canned answers, so the page works either way.

## Run it

Static preview, without AI or n8n:

```bash
npx serve public      # or open public/index.html directly
```

Full local dev, with the functions:

```bash
npm install
cp .env.example .env  # fill in values; never commit .env
npx netlify dev
```

Tests:

```bash
npm test
```

## Deploy (Netlify)

Connect the repo and Netlify picks up `netlify.toml`, which publishes `public/` and runs functions from `netlify/functions/`. Set the variables from `.env.example` in Netlify's environment settings.

## n8n webhook verification

Each request to n8n carries two headers, `X-Andi-Timestamp` and `X-Andi-Signature`. The signature is computed like this:

```
hex( HMAC_SHA256( N8N_WEBHOOK_SECRET, timestamp + "." + rawBody ) )
```

In n8n, recompute it in a Code node and reject a mismatch or a timestamp older than five minutes. Leads with `smsConsent: false` must not get automated texts.

## Before going live

- Set `CONFIG.sellerName` in `public/js/core.js` to the dealer's legal name, because the consent text names it.
- Have the consent wording and page copy reviewed for TCPA and Andersen co-op advertising compliance.
- Dashboard data lives in each browser's localStorage. Use Google Sheets through n8n as the shared record until a real backend exists.
- Put the dashboard behind authentication, such as Netlify password protection or Cloudflare Access, before real leads flow.

## Contributing

Every change goes through a PR. See [CONTRIBUTING.md](CONTRIBUTING.md). The repo is public, so never commit keys, phone numbers or lead data. Demo leads use fictional names, 555 numbers and example.com emails.
