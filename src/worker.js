import { buildPushHTTPRequest } from '@pushforge/builder';
import { computeDebt, computeStreak, todayTotals, day, warsawHour, sum, elapsed, CATEGORIES } from './logic.js';

const json = (data, status = 200) => Response.json(data, { status });
const nowTs = () => Math.floor(Date.now() / 1000);
const fmt = m => {
  const r = Math.round(Math.abs(m)), h = Math.floor(r / 60), min = r % 60;
  return [h && `${h} ч`, (min || !h) && `${min} мин`].filter(Boolean).join(' ');
};

const getState = async (env, key) =>
  (await env.DB.prepare('SELECT value FROM state WHERE key = ?').bind(key).first('value')) ?? null;
const setState = (env, key, value) =>
  env.DB.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').bind(key, value).run();
const delState = (env, key) => env.DB.prepare('DELETE FROM state WHERE key = ?').bind(key).run();

// { began, start (null while paused), accum (seconds), cat } or null; reads the pre-pause 'timer_start' key too
async function getTimer(env) {
  const t = await getState(env, 'timer');
  if (t) return JSON.parse(t);
  const old = Number(await getState(env, 'timer_start'));
  return old ? { began: old, start: old, accum: 0, cat: null } : null;
}

// shortcut: loads every entry on each call, fine for one person for years; add a SUM query if it ever gets slow
const allEntries = async env =>
  (await env.DB.prepare('SELECT * FROM entries ORDER BY start_ts DESC').all()).results;

// OpenDota's `date` = days back; cover everything since START_TS so missed days are caught up
const daysSinceStart = env => Math.ceil((nowTs() - Number(env.START_TS)) / 86400) + 1;

async function syncMatches(env) {
  const base = `https://api.opendota.com/api/players/${env.STEAM_ID}`;
  // asks OpenDota to pull fresh history; new matches show up on a later run
  const headers = { 'User-Agent': 'dota-polski (+https://github.com/a1exymoroz/dota-polski)' };
  await fetch(`${base}/refresh`, { method: 'POST', headers }).catch(() => {});
  const r = await fetch(`${base}/matches?date=${daysSinceStart(env)}`, { headers });
  if (!r.ok) throw new Error(`OpenDota ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return insertMatches(env, await r.json());
}

// matches come from OpenDota via the cron or via the phone (Cloudflare's shared IPs often hit OpenDota's daily limit)
async function insertMatches(env, matches) {
  if (!Array.isArray(matches)) throw new Error('matches must be an array');
  matches = matches.filter(m =>
    [m.match_id, m.start_time, m.duration].every(Number.isInteger) &&
    m.duration > 0 && m.duration < 4 * 3600 && m.start_time >= Number(env.START_TS));
  if (!matches.length) return 0;
  const insert = env.DB.prepare(
    "INSERT OR IGNORE INTO entries (kind, start_ts, minutes, match_id) VALUES ('dota', ?, ?, ?)");
  const res = await env.DB.batch(matches.map(m => insert.bind(m.start_time, m.duration / 60, m.match_id)));
  return res.filter(x => x.meta.changes > 0).length;
}

async function sendPush(env, title, body) {
  const sub = await getState(env, 'push_sub');
  if (!sub) return { sent: false, reason: 'no subscription' };
  const { endpoint, headers, body: payload } = await buildPushHTTPRequest({
    privateJWK: JSON.parse(env.VAPID_PRIVATE),
    subscription: JSON.parse(sub),
    message: { payload: { title, body }, adminContact: env.CONTACT },
  });
  const r = await fetch(endpoint, { method: 'POST', headers, body: payload });
  if (r.status === 404 || r.status === 410) await delState(env, 'push_sub'); // subscription expired
  return { sent: r.ok, status: r.status };
}

async function cron(env) {
  const added = await syncMatches(env).catch(() => 0); // rate-limited: the phone syncs on open instead
  const now = nowTs();
  const debt = computeDebt(await allEntries(env));
  const limit = Number(env.DEBT_LIMIT);
  if (added) {
    const tail = debt > limit ? ' — сначала польский, потом катка!' : '';
    await sendPush(env, `Матчей: +${added}`, `Долг польского: ${fmt(debt)}${tail}`);
  } else if (debt > 0 && warsawHour(now) >= 20 && (await getState(env, 'evening_day')) !== day(now)) {
    await setState(env, 'evening_day', day(now));
    await sendPush(env, 'Czas na polski 🇵🇱', `Долг: ${fmt(debt)}`);
  }
}

async function api(req, env, path) {
  const now = nowTs();
  const route = `${req.method} ${path}`;

  if (route === 'GET /api/status') {
    const entries = await allEntries(env);
    return json({
      debt: computeDebt(entries),
      ...todayTotals(entries, now),
      streak: computeStreak(entries, now),
      timer: await getTimer(env),
      debtLimit: Number(env.DEBT_LIMIT),
      steamId: env.STEAM_ID,
      startTs: Number(env.START_TS),
      syncDays: daysSinceStart(env),
      dotaTotal: sum(entries, 'dota'),
      studyTotal: sum(entries, 'study'),
      recent: entries.slice(0, 20),
    });
  }
  if (route === 'POST /api/sync') return json({ added: await syncMatches(env) });
  if (route === 'POST /api/matches') return json({ added: await insertMatches(env, await req.json()) });
  if (route.startsWith('POST /api/timer/')) {
    const t = await getTimer(env);
    const action = path.slice('/api/timer/'.length);
    if (action === 'start') {
      if (t) return json({ ok: true }); // a second tap doesn't reset a running session
      const { category } = await req.json().catch(() => ({}));
      if (!CATEGORIES.includes(category)) return json({ error: `category: ${CATEGORIES.join(', ')}` }, 400);
      await setState(env, 'timer', JSON.stringify({ began: now, start: now, accum: 0, cat: category }));
      return json({ ok: true });
    }
    if (!t) return json({ error: 'timer not running' }, 400);
    if (action === 'pause' && t.start) await setState(env, 'timer', JSON.stringify({ ...t, accum: elapsed(t, now), start: null }));
    else if (action === 'resume' && !t.start) await setState(env, 'timer', JSON.stringify({ ...t, start: now }));
    else if (action === 'stop') {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO entries (kind, start_ts, minutes, note) VALUES ('study', ?, ?, ?)")
          .bind(t.began, elapsed(t, now) / 60, t.cat),
        env.DB.prepare("DELETE FROM state WHERE key IN ('timer', 'timer_start')"),
      ]);
    } else if (!['pause', 'resume'].includes(action)) return json({ error: 'not found' }, 404);
    return json({ ok: true });
  }
  if (route === 'POST /api/dota/manual') {
    const { minutes } = await req.json().catch(() => ({}));
    if (!(Number.isFinite(minutes) && minutes > 0 && minutes <= 600)) return json({ error: 'minutes 1..600' }, 400);
    await env.DB.prepare("INSERT INTO entries (kind, start_ts, minutes, note) VALUES ('dota', ?, ?, 'вручную')")
      .bind(now, minutes).run();
    return json({ ok: true });
  }
  const del = route.match(/^DELETE \/api\/entries\/(\d+)$/);
  if (del) {
    await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(Number(del[1])).run();
    return json({ ok: true });
  }
  if (route === 'POST /api/push/subscribe') {
    const sub = await req.json().catch(() => null);
    if (!(sub?.endpoint?.startsWith('https://') && sub.keys?.p256dh && sub.keys?.auth))
      return json({ error: 'bad subscription' }, 400);
    await setState(env, 'push_sub', JSON.stringify(sub));
    return json({ ok: true });
  }
  if (route === 'POST /api/push/test') return json(await sendPush(env, 'Dota → Polski', 'Уведомления работают ✅'));
  return json({ error: 'not found' }, 404);
}

export default {
  // static files from public/ are served before this runs
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (!path.startsWith('/api/')) return json({ error: 'not found' }, 404);
    if (req.headers.get('Authorization') !== `Bearer ${env.API_TOKEN}`) return json({ error: 'unauthorized' }, 401);
    try {
      return await api(req, env, path);
    } catch (err) {
      return json({ error: String(err.message || err) }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cron(env));
  },
};
