# MovieDirector

Your own branded website on top of fal.ai's
[`minimax/h3-max/reference-director`](https://fal.ai/models/minimax/h3-max/reference-director)
real-time world model. Users sign up, top up credit with Stripe, upload character
reference images, and direct a live AI movie. Every second is charged to their balance
with your markup on top of fal's price.

## How it works

This model is **not** a normal request/response API. It is a live **WebRTC stream**: the
browser opens a session, sends a `configure` message (prompt, references, resolution) and then
`prompt` messages to steer the story while video and audio stream back at 24 fps. fal bills
**$0.05 per streamed second** (× 1.0–1.2 depending on resolution).

```
Browser (Studio)                    Your server (Next.js)                      fal.ai
───────────────                     ─────────────────────                      ──────
POST /api/sessions {resolution} ──▶ checks balance, creates RenderSession
fal.realtime.open(wma(...))
  POST /api/fal/proxy?sid=… ──────▶ /ice      → forwarded (free)         ──▶ wma.fal.run
                                    /session  → balance check, forward,  ──▶ GPU session starts
                                                mark session active
  every 5s heartbeat ─────────────▶ /session/heartbeat → CHARGE elapsed  ──▶ keeps lease alive
                                    seconds × price × (1 + markup)
                                    out of credit? reply {alive:false},
                                    stop forwarding → session ends
◀══════════════ video + audio over WebRTC (peer to peer) ════════════════════ model
```

Your `FAL_KEY` only ever lives on the server. The proxy (`src/app/api/fal/proxy/route.ts`) only
lets signed-in users reach this one model's realtime bridge. Every 5-second heartbeat passes
through it, so it is both the **meter** and the **kill switch**.

### Your margin

Set `MARKUP_PERCENT` (default `30`). For each session the database stores both what the user
paid (`chargedMc`) and what fal charged you (`falCostMc`). `/admin` shows totals and profit.

| Resolution | fal cost / min | User price / min at 30% |
|------------|----------------|-------------------------|
| 480p       | $3.00          | $3.90                   |
| 768p–1440p | $3.60          | $4.68                   |

Remember that Stripe takes roughly 2.9% + 30¢ per top-up, so keep the markup above that.

## Setup

```bash
cp .env.example .env      # fill in FAL_KEY, AUTH_SECRET, DATABASE_URL, Stripe keys
npm install
npm run db:push           # creates the tables in your Postgres database
npm run dev               # http://localhost:3000
```

Any Postgres works. A free Neon database is the easiest; you can use the same one as Vercel.

Stripe webhooks in development:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
# copy the whsec_... it prints into STRIPE_WEBHOOK_SECRET
```

Credit is only added from the signed webhook (`checkout.session.completed`), never from the
browser's success redirect. Repeated deliveries are ignored.

## Deploying

1. Import the repo into Vercel (framework: Next.js; no build settings to change).
2. In the project, open **Storage → Create Database → Neon (Postgres)** and connect it. This sets
   `DATABASE_URL`. Every build then runs `vercel-build`, which creates or updates the tables.
3. Add the env vars from `.env.example` under **Settings → Environment Variables**, with
   `APP_URL` set to your site's address, and redeploy.
4. In the Stripe dashboard, add a webhook endpoint at `https://your-domain/api/billing/webhook`
   for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
5. Add your email to `ADMIN_EMAILS` to open `/admin`.

## Project layout

| Path | What it does |
|------|--------------|
| `src/app/api/fal/proxy/route.ts` | Authenticated fal proxy. Meters heartbeats and cuts off users who are out of credit |
| `src/lib/billing.ts` | Charging logic: per-second debits, race-safe, ends sessions at zero balance |
| `src/lib/pricing.ts` | fal price, resolution multipliers, markup |
| `src/app/studio/Studio.tsx` | Director UI: references, prompt, live video, mid-stream directions, recording download |
| `src/app/api/upload/route.ts` | Uploads reference images to fal storage server-side |
| `src/app/api/billing/*` | Stripe Checkout and webhook |
| `src/app/billing`, `src/app/admin` | Usage history and the revenue dashboard |

## Things to know

- **Experimental fal client.** Realtime sessions need `@fal-ai/client@alpha`, which fal labels as
  experimental. The versions are pinned exactly; test before upgrading.
- **Billing is by wall-clock time** from session start, measured on your server. The model streams in
  real time, so this tracks what fal bills you. Check it against your fal usage dashboard.
- **Resolution is chosen when the session is reserved**, and the user is billed at that rate.
  The resolution sent to the model goes peer to peer, so a tampered client could ask for a higher
  one. The most that costs is the 1.2× multiplier, which your markup covers if it is above 20%.
- **After a cut-off**, fal ends the session once heartbeats stop. That can take a few seconds,
  and those seconds are on you. The studio also stops itself as soon as the server reports zero
  credit. Users need `MIN_START_SECONDS` of credit to start, which limits how often this happens.
- **Moderation:** fal runs its safety checker (`prompt_rejected` with `content_policy`). Add
  your own terms of service and abuse handling before launch.
