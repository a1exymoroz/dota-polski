import { buildPushHTTPRequest } from '@pushforge/builder';
import { computeDebt, computeStreak, todayTotals, day, warsawHour } from './logic.js';

const json = (data, status = 200) => Response.json(data, { status });
const nowTs = () => Math.floor(Date.now() / 1000);
const fmt = m => {
  const r = Math.round(Math.abs(m)), h = Math.floor(r / 60);
  return (h ? `${h} ч ` : '') + `${r % 60} мин`;
};

const getState = async (env, key) =>
  (await env.DB.prepare('SELECT value FROM state WHERE key = ?').bind(key).first('value')) ?? null;
const setState = (env, key, value) =>
  env.DB.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)').bind(key, value).run();
const delState = (env, key) => env.DB.prepare('DELETE FROM state WHERE key = ?').bind(key).run();

// shortcut: loads every entry on each call, fine for one person for years; add a SUM query if it ever gets slow
const allEntries = async env =>
  (await env.DB.prepare('SELECT * FROM entries ORDER BY start_ts DESC').all()).results;

async function syncMatches(env) {
  const base = `https://api.opendota.com/api/players/${env.STEAM_ID}`;
  // asks OpenDota to pull fresh history; new matches show up on a later run
  await fetch(`${base}/refresh`, { method: 'POST' }).catch(() => {});
  const r = await fetch(`${base}/matches?date=2`);
  if (!r.ok) throw new Error(`OpenDota ${r.status}`);
  const matches = await r.json();
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
  const added = await syncMatches(env);
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
      timerStart: Number(await getState(env, 'timer_start')) || null,
      debtLimit: Number(env.DEBT_LIMIT),
      recent: entries.slice(0, 20),
    });
  }
  if (route === 'POST /api/sync') return json({ added: await syncMatches(env) });
  if (route === 'POST /api/timer/start') {
    // OR IGNORE: a second tap doesn't reset a running timer
    await env.DB.prepare("INSERT OR IGNORE INTO state (key, value) VALUES ('timer_start', ?)").bind(String(now)).run();
    return json({ ok: true });
  }
  if (route === 'POST /api/timer/stop') {
    const start = Number(await getState(env, 'timer_start'));
    if (!start) return json({ error: 'timer not running' }, 400);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO entries (kind, start_ts, minutes) VALUES ('study', ?, ?)").bind(start, (now - start) / 60),
      env.DB.prepare("DELETE FROM state WHERE key = 'timer_start'"),
    ]);
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
