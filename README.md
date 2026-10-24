# Dota → Polski 🇵🇱

Study Polish for as long as you play Dota 2. One minute of Dota = one minute of Polish.

- Matches come from [OpenDota](https://www.opendota.com): the phone fetches them every time the app opens, and the server tries every 15 minutes (Cloudflare's shared IPs often hit OpenDota's daily limit).
- Start/Stop timer for Polish study sessions (keeps running if you close the app).
- Debt, day streak 🔥, manual Dota entries, deleting wrong entries.
- Push notifications: after new matches, in the evening (20:00 Warsaw time) if the debt isn't paid off, and a warning when the debt exceeds `DEBT_LIMIT`.

Stack: Cloudflare Worker (frontend + API + cron) + D1 (SQLite) + PWA. Runs on Cloudflare's free plan.

## Setup

1. In Dota: *Settings → Social → "Expose Public Match Data"* (otherwise OpenDota can't see your matches).
2. Your Steam32 ID — the number in your opendota.com profile URL.
3. A Cloudflare account (free).

## Deploy

```bash
npm install
npx wrangler login
npx wrangler d1 create dota-polski        # put database_id into wrangler.toml
npx wrangler d1 execute dota-polski --remote --file schema.sql
npx @pushforge/builder vapid              # public key -> VAPID_PUBLIC in public/app.js
npx wrangler secret put API_TOKEN         # any long random password
npx wrangler secret put STEAM_ID
npx wrangler secret put VAPID_PRIVATE     # private JWK from the vapid command, on one line
npx wrangler deploy
```

Matches before `START_TS` (unix time in `wrangler.toml`) are ignored.

## Install on iPhone (iOS 16.4+)

1. Open the worker URL in **Safari** → Share → "Add to Home Screen".
2. Open the app **from the icon** and enter your `API_TOKEN`.
3. Tap "🔔 уведомления" (notifications) → allow. A test notification will arrive.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in the values
npx wrangler d1 execute dota-polski --local --file schema.sql
npx wrangler dev --test-scheduled  # http://localhost:8787, cron: /__scheduled
npm test
```

On Windows, local D1 fails with `SQLITE_CANTOPEN` when the project path is very long — move the project to a short path.
