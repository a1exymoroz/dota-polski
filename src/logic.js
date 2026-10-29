const TZ = 'Europe/Warsaw';

// 'YYYY-MM-DD' in Warsaw time for a unix timestamp (seconds)
export const day = ts => new Date(ts * 1000).toLocaleDateString('sv-SE', { timeZone: TZ });

export const warsawHour = ts =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(ts * 1000));

export const CATEGORIES = ['reading', 'watching', 'course', 'duolingo'];

// seconds studied in a timer session: banked time plus the running stretch (start is null while paused)
export const elapsed = (t, now) => t.accum + (t.start ? now - t.start : 0);

export const sum = (entries, kind) => entries.filter(e => e.kind === kind).reduce((s, e) => s + e.minutes, 0);

// > 0: owe Polish minutes, < 0: banked credit
export const computeDebt = entries => sum(entries, 'dota') - sum(entries, 'study');

export function todayTotals(entries, now) {
  const today = entries.filter(e => day(e.start_ts) === day(now));
  return { dotaToday: sum(today, 'dota'), studyToday: sum(today, 'study') };
}

// Consecutive active days (newest first) where study >= dota. Idle days are skipped;
// today doesn't break the streak while it's still in progress.
export function computeStreak(entries, now) {
  const days = {};
  for (const e of entries) {
    const d = (days[day(e.start_ts)] ??= { dota: 0, study: 0 });
    d[e.kind] += e.minutes;
  }
  const today = day(now);
  let streak = 0;
  for (const d of Object.keys(days).sort().reverse()) {
    const ok = days[d].study >= days[d].dota;
    if (ok) streak++;
    else if (d !== today) break;
  }
  return streak;
}
