# Finder Agent — spec v0

**Owner:** Zach. **Status:** spec, not built. Decisions behind this are in `DECISIONS.md` (D3–D9, D11); client inputs in `JP_BRIEF.md`.

## One sentence

A scheduled job that finds public posts by people within 100 miles of Baton Rouge who want new windows or doors (≤ 6 months old), judges whether each one is a real homeowner with real intent, enriches it with contact info where possible, emails JP the lead, and — on JP's tap — sends the person a short human invite to a free consultation with a link to the website.

## Pipeline

```
sources ──▶ normalise ──▶ filter ──▶ judge (Jev) ──▶ enrich ──▶ store ──▶ email JP ──▶ [JP tap] ──▶ invite email
```

### 1. Sources (phased — start with one, prove the loop, add more)

| Phase | Source | How | Notes |
|---|---|---|---|
| **P0** | Facebook public groups + pages | Third-party scraper (Apify-style actor) on a curated list of Louisiana groups — Baton Rouge / Prairieville / Denham Springs / Covington / Mandeville / Hammond / Lafayette / Metairie / Kenner / Slidell community, "recommendations", homeowner, and buy-sell groups | Direct scraping with our own accounts = bans. Public content only. Never log in to private groups with a bot. |
| **P0** | Google (web) | Search API / SERP provider: `site:facebook.com`, `site:nextdoor.com`, `site:reddit.com` (r/batonrouge, r/NewOrleans, r/Louisiana, r/lafayette) + keywords + city names | Cheap, legal, surprisingly good. Catches Nextdoor without a Nextdoor scraper. |
| P1 | Instagram | Hashtag/keyword scraper on `#batonrouge` × home-reno tags; bio/location filter | IG keyword search is weak; expect low yield. Don't over-invest. |
| P1 | Google Maps reviews | Reviews of competitor window companies in the radius | Unhappy reviewers ("they never showed up", "quote was insane") are warm. |
| P2 | Building permits | EBR, Ascension, Livingston, St. Tammany, Jefferson, Lafayette parish permit portals | Someone pulling a window/door permit is a lead by definition. Public record. Address → owner via assessor. |
| P2 | Storm / hail events | NWS alerts → affected ZIPs → bump priority for posts from there | Window damage spikes after storms. |

### 2. Normalise

Every hit becomes one `candidate`: `{ source, url, author_name, author_handle, author_profile_url, text, posted_at, location_hint (group name / city / profile location), media[], fetched_at }`.

### 3. Filter (hard rules, no AI)

- `posted_at` ≥ now − 6 months — else drop (D6).
- Location resolves inside the 100-mile circle around Baton Rouge (30.4515, −91.1871) — geocode the `location_hint`; group-level location counts if the post has none. Unknown location = keep but flag `geo_unverified`.
- At least one keyword from `JP_BRIEF.md` (base layer or comfort layer), case-insensitive, fuzzy.
- Dedupe on `url`, then on `(author_handle, text-hash)` — reposts across groups are one lead.
- Drop obvious contractors / ads: author is a page, text contains "call us", "we offer", "licensed and insured", phone-number pattern + "free estimate".

### 4. Judge — Jev (this is a classify + score over many items → Jev, always)

For each candidate, one Jev call asking:

- `is_homeowner_intent`: homeowner wanting windows/doors for their own home · contractor/vendor advertising · job posting · news/article · unrelated → one class.
- `intent_strength` 0–1: "we need to replace all our windows before summer" vs "windows are kinda old lol".
- `service`: window · door · both · unclear.
- `frames_tags[]`: F / R / A / M / E / S (from the wants list).
- `problem_tags[]`: drafts, condensation, seal failure, won't lock, rot, cracked, storm damage, high bills, heat, noise, security, aesthetics.
- `urgency`: now / this season / someday.

Thresholds: `intent_strength ≥ 0.6` and class = homeowner → proceed. `0.4–0.6` → daily digest only, no enrichment. Below → drop (but store, for tuning). Pass raw post text as state, never a summary.

### 5. Enrich (D9 — provider undecided)

Goal: `author_name + city/state` → phone, email, street address, homeowner yes/no, home value.

| Candidate provider | Why / why not |
|---|---|
| Real-estate skip-trace APIs (BatchData, Tracerfy, Endato/Enformion, Skip Genie) | Built for exactly this — owner name/address → phones + emails. Per-lookup pricing, cents to ~$0.20. **Likely winner.** |
| People Data Labs | Decent person enrichment API, weaker on US consumer phones. |
| Spokeo / Whitepages (consumer sites) | No usable API; Whitepages Pro became Ekata (Mastercard) — enterprise contract. JP can use the consumer sites manually as a fallback. |
| County assessor lookup | Free. Address → owner name + home value. Pairs with skip-trace. |

Rules: match confidence must be reported and shown to JP; a wrong-person match is worse than no match. Never enrich a candidate that didn't pass the judge. Enrichment output is stored encrypted-at-rest and never in logs.

**Legal, briefly:** emailing an enriched address is CAN-SPAM territory (allowed: real sender, physical postal address, working unsubscribe — we'll meet all three). Texting it is TCPA — **we don't text.** JP calling it is a telemarketing call → his company's Do-Not-Call scrubbing applies; we surface the number, he follows his process.

### 6. Store

A `leads` table (Postgres on Railway, or Supabase) — `candidate` + judge output + enrichment + `status` (`new` → `emailed_jp` → `invite_approved` → `invite_sent` → `jp_contacted` / `skipped`) + timestamps. Quincy's n8n/Sheets flow can read it if Agent 1 wants to know a visitor was a Finder lead (match on email/phone).

### 7. Email JP (D4)

- **Hot (intent ≥ 0.8):** one email per lead, immediately.
- **Everything else:** one daily digest, 7 AM CT.
- Each lead block: name · where (city + source group) · when posted · **their exact words** (quoted, with link) · service + tags · enrichment (phone / email / address + confidence) · two buttons: **Send invite** · **Skip**. Buttons are signed one-tap links (HMAC, expire in 7 days) hitting the Finder's own endpoint.
- From: the project domain (Vercel now, `.com` later). Reply-to: JP. Sending via Resend or Postmark; `JP_EMAIL` from env.

### 8. Invite email to the prospect (D8 → D14: automatic)

**Sent automatically by the Finder** when a lead passes the judge and enrichment returns an email (D14, supersedes the one-tap default). JP still receives his copy of every lead (§7); the **Send invite / Skip** buttons become **Resend / Mark dead**. `INVITES_ENABLED=false` stops invites without stopping sourcing. Only when we have an email for them. Short, specific, sounds like a person. Template — the `{…}` parts are filled from the post, nothing else is generated:

> **Subject:** Your {windows / front door / patio door} — quick question
>
> Hi {first name},
>
> Saw your post in {group name} about {their issue, in their words — e.g. "the condensation between the panes"}. I'm JP, I'm a design consultant with Renewal by Andersen here in {their city or "the Baton Rouge area"}.
>
> If it'd help, I do free in-home consultations — about an hour, I measure everything, show you options, and leave you a real number. No pressure either way.
>
> You can grab a time that works here: {site link with ?src=finder&lead={id}}
>
> Or just reply to this email.
>
> JP
> Renewal by Andersen · {phone} · {showroom postal address}
> {unsubscribe line}

Rules: one email, no sequence, no follow-up unless JP asks. Never mention that software found the post. Never quote more than one short phrase of theirs. Link carries the lead id so Agent 1 (Andi) knows this visitor came from the Finder and can skip questions we already know.

### 9. Runtime (D11)

Node (TypeScript) on Railway, cron every 6 hours. Env: `JP_EMAIL`, scraper key, SERP key, enrichment key, email-provider key, `SIGNING_SECRET`, `DATABASE_URL`, `SITE_URL`. Kill switch: `FINDER_ENABLED=false` stops sourcing; `INVITES_ENABLED=false` stops invites independently.

### 10. Admin dashboard — `<vercel-domain>/admin` (D15, D16)

Same Vercel project as the website; reads the Finder's `leads` table through authenticated API routes. Login: email + password for a small allowlist (Zach, Quincy, JP), signed HttpOnly session cookie, rate-limited, no public signup. Every `/api/admin/*` route checks the session server-side — the HTML is never the gate.

Screens (all one page, console-style — see D16 and the published mock):

| Panel | Shows |
|---|---|
| **Top bar** | breadcrumb `Lead Agent / Finder / Louisiana`, live clock, last-run time, search, alerts count |
| **Sidebar** | `[FINDER]` · Leads · Invites · Runs · Alerts · Settings; source toggles (Facebook / Instagram / Google / Maps / Permits) that mirror `FINDER_ENABLED` per source |
| **Map hero** | dot-matrix Louisiana, the 100-mile circle around Baton Rouge, one dot per lead (orange = invited, dark = pending, hollow = dead); click = select |
| **Pipeline tiles** | Found · Passed judge · Enriched · Invited · Replied · Booked · Dead — this month, with sparkline of the last 30 days |
| **Lead inspector** | selected lead: name, city, source + group, **profile link (FB/IG) when we have it**, their post (quoted + link), judge output (intent, service, FRAMES/problem tags, score), enrichment (phone / email / address + confidence), status timeline, **the exact invite email that was sent** (subject + body, sent-at, opened/replied if the provider reports it), actions: Resend · Mark dead · Mark booked · Copy for CRM |
| **Leads table** | filter by status / source / city / date; sort by score; CSV export |
| **Activity feed** | run started/finished (counts), lead found, invite sent, reply received, errors — severity-tagged like an alert feed |
| **Runs** | each cron run: sources hit, candidates, passed, cost (API calls), duration, errors |

Data: `leads` (§6) + `invites` (lead_id, to, subject, body, sent_at, provider_id, opened_at, replied_at) + `runs` + `events`. Postgres (Supabase) so the Finder on Railway and the Vercel routes share one DB.

## Cost sketch (per month, to be measured)

Scraper actor ~$30–60 · SERP API ~$20 · enrichment ~$0.10–0.20 × leads that pass the judge (hundreds, not thousands) · Jev + Claude pennies · email free tier · Railway ~$5. Call it **under $150/mo** until it proves out — vs $1,000 per vendor lead.

## Open questions

1. Enrichment provider — pick + price (Zach to eval).
2. Invite send: JP-approved (default) or automatic? (JP to confirm.)
3. Sending domain for the invite email — needs SPF/DKIM on a domain we control; `rbasola.com` is the company's, we won't have DNS. Use the project `.com` with reply-to JP.
4. Which Facebook groups — build the list (Zach + JP; JP knows the parishes).
5. Showroom postal address + JP's work phone for the email footer.
6. Where Agent 1 reads `?src=finder&lead=` from (Quincy).

## Build order

**P0 (prove the loop):** FB groups + Google → filter → Jev → store → email JP. No enrichment, no invite. Measure: how many real leads per week, how many JP actually calls.
**P1:** enrichment + invite email with one-tap approve + Andi handoff.
**P2:** Instagram, Maps reviews, permits, storm bumps.
