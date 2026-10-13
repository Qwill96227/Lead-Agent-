# Decisions Log

Every decision about this project, dated, with the reasoning — so either of us (or either of our Claudes) can see how we got here. **Append, don't rewrite.** Add via PR like everything else.

Format: date · decision · why · who decided.

---

## 2026-10-11

**D1 — Every change goes through a PR. Nobody pushes `main`.**
Why: two devs (Quincy + Zach) working in parallel; PRs stop clashes. Branch protection still needs Quincy (admin) to enable. — Zach. (PR #1, merged.)

**D2 — All project discussion and decisions get logged in this repo.**
Why: Zach's and Quincy's Claude sessions can't see each other's chats; the repo is the shared brain. Decisions here, JP's inputs in `JP_BRIEF.md`, specs in their own docs. — Zach.

**D3 — Two agents, split ownership.**
- **Agent 1, "Andi" (website)** — Quincy. Inbound: visitor chats through intake, picks an appointment slot, it goes to JP.
- **Agent 2, "Finder"** — Zach. Outbound: scrapes Facebook, Instagram, Google (+ anything else useful) for people in range saying they want new windows/doors, and emails JP.
Why: JP and Zach walked through it in person 10/11 — the website only catches people who come to it; the Finder goes and gets them. — Zach + JP.

**D4 — Finder delivers leads to JP by email. Not Telegram, not SMS.**
Why: JP's words — he doesn't want his phone blown up; he reads the email, decides if it's worth it, and calls. Delivery address lives in env var `JP_EMAIL`, never in the repo (public). — JP.

**D5 — Geography: Louisiana, 100-mile radius from Baton Rouge. Any city inside that.**
— JP.

**D6 — Post recency: ≤ 6 months. Anything older is skipped, every run.**
— JP.

**D7 — Keyword-driven, JP supplies the list** (see `JP_BRIEF.md`). Zach adds a second "comfort/energy" layer on top (people complaining about heat, drafts, power bills who don't know they need windows yet).
Why: the product's headline benefit is comfort (hot outside, cool inside) — those posts are leads too. — JP + Zach.

**D8 — When the Finder can't get a phone number, it sends the person a short, human, personalised email inviting them to a free consultation for whatever they posted about (window or door) with a link to the website.**
Why: a scraped post is a tip, not a lead. The email turns it into a site visit, and Andi (Agent 1) takes it from there. Must read like JP wrote it — no AI slop. — Zach.
Open: whether JP approves each invite with one tap before it sends, or it sends automatically. Default until JP says otherwise: **one-tap approve** (his earlier instruction was "the agent doesn't contact them, I do").

**D9 — Finder enriches automatically** (name + city → phone / email / address) where a provider can do it reliably.
Why: gets JP closer to the full lead record he's used to. Provider not chosen — Spokeo/Whitepages are consumer sites without usable APIs; candidates in `FINDER_AGENT.md`. — Zach. Open: provider + cost + JP's comfort with calling enriched numbers (DNC applies).

**D10 — Website: Vercel now, a `.com` domain later.** Quincy is building it. — Zach.

**D11 — Finder runtime: probably Railway** (always-on Node cron). Not final. — Zach.

**D12 — Real customer data never enters this repo.** JP's Salesforce screenshots and company KPI reports have real names/phones/addresses and internal numbers. We keep the *field schema* and *takeaways* only. — Zach. (Repo is public — see D13.)

**D13 — Repo should go private before any lead data, keys, or customer info touches it.** Needs Quincy (owner). — Zach. Open.

## 2026-10-12

**D18 — Supabase Postgres is the shared leads database for both agents. Proposed, needs Zach's OK.**
Website (Andi) leads are stored in a `leads` table with a `source` column (`website` / `finder`) so the Finder and the admin dashboard (Zach's D15) can use the same table. Consent records go in `lead_consents`. Only server code connects, with the secret key. RLS is on with no policies, so the browser and the public key get nothing. Schema in `supabase/migrations/`. Numbered D18 because D14–D17 are still on Zach's branch. — Quincy.
Open: Zach to confirm the shared table works for Finder fields (judge output and enrichment can go in `details` or his own columns). The repo should go private (D13) before real leads are stored, even though lead data lives in Supabase, not the repo.
