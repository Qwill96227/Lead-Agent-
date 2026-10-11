# Andi — AI Lead-Gen Agent for a Renewal by Andersen Rep

Agent-as-a-Service (AaaS) lead generation system: a conversational AI agent ("Andi") plus n8n workflows that qualify homeowners and book appointments for a single Baton Rouge window replacement sales rep.

## Purpose & scope

- Building an AaaS lead generation system for a single Renewal by Andersen window replacement sales rep based in Baton Rouge.
- Territory is roughly a 100-mile radius: New Orleans metro, Northshore/Hammond, Lafayette, Natchez/McComb.
- Goal: qualified homeowner leads and booked appointments via an AI-powered funnel, targeting roughly 36 leads and 16 appointments per month at a sustainable ROAS.
- Core product is a conversational AI agent named "Andi" that qualifies homeowners through a four-step intake flow (pain points → window count → home type → installation timeline), captures contact info, and routes leads into an automated sales workflow.
- A PDF project document is the source of truth for the build.
- Architecture is deliberately scoped to a single rep rather than a multi-dealer marketplace, to keep it simple.

## Current state

- A complete single-file HTML landing page has been built.
- The landing page includes a ten-state conversation engine in vanilla JS with quick-reply buttons and free-text input.
- Claude API integration is isolated in a proxy-ready function.
- Lead capture form includes TCPA-compliant disclaimer language.
- Design uses a navy/gold color scheme with Fraunces and Manrope typefaces, per the PDF reference design.
- The flow ends with a personalized AI-generated confirmation message.
- An n8n-based agentic workflow system has been designed across six interconnected workflows:
  1. Lead intake with 60-second SMS outreach
  2. SMS conversational booking agent with calendar tools
  3. Multi-day nurture sequences
  4. Pre-appointment reminders
  5. Post-appointment outcome routing
  6. Daily performance digest
- An importable n8n JSON for Workflow 1 has been produced: Claude Sonnet scores leads and drafts personalized SMS openers, with hot-lead Slack alerts, Google Sheets logging, and Twilio for SMS.
- A five-zone security architecture has been designed for production deployment:
  - Cloudflare edge defense (Turnstile CAPTCHA + WAF)
  - Serverless proxy holding the Anthropic API key in environment variables rather than client-side
  - HMAC-signed webhook verification between Andi and n8n
  - n8n editor reachable only via Cloudflare Tunnel with 2FA
  - Twilio locked to US geography with a daily spend cap

## On the horizon

- Full tech stack discussion is next, once rep intake answers are collected.
- Open decision: n8n deployment path — self-hosted Community Edition vs. cloud trial (~$24/month) for initial validation.
- Remaining pre-launch gaps: live appointment booking integration; offline conversion tracking (optimizing for closed deals, not just form fills); Andersen co-op advertising compliance review.

## Key learnings & principles

- Andi in its current form functions as a smart form rather than a true agent — objection handling, calendar booking, and follow-up loops are needed for genuine agentic capability.
- Client-side API key exposure is a critical security flaw that must be resolved via serverless proxy before live traffic.
- Speed-to-lead is critical in home services; the 60-second SMS outreach design directly addresses this.
- Self-generated digital leads likely close at a lower rate than company-provided leads, so close-rate assumptions should be stress-tested.

## Tools & resources

| Layer | Tool |
|---|---|
| Frontend | Single HTML file hosted on Netlify, vanilla JS |
| AI | Anthropic Claude API (Sonnet for agent and scoring tasks) |
| Automation | n8n |
| SMS | Twilio |
| Security / CDN | Cloudflare (WAF, Turnstile, Tunnel) |
| CRM / logging | Google Sheets now; GHL or Structurely optional for SMS speed-to-lead |
| Paid traffic | Google Search, Meta, Nextdoor, retargeting |
