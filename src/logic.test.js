import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDebt, computeStreak, todayTotals, day, elapsed } from './logic.js';

test('timer elapsed counts banked time plus the running stretch', () => {
  assert.equal(elapsed({ start: 1000, accum: 0 }, 1600), 600);
  assert.equal(elapsed({ start: null, accum: 300 }, 9999), 300);   // paused: frozen
  assert.equal(elapsed({ start: 2000, accum: 300 }, 2100), 400);   // resumed
});

const D = 86400;
const now = Date.UTC(2026, 9, 24, 12) / 1000; // 24 Oct 14:00 Warsaw
const e = (kind, daysAgo, minutes) => ({ kind, start_ts: now - daysAgo * D, minutes });

test('debt is dota minus study', () => {
  assert.equal(computeDebt([e('dota', 0, 40), e('dota', 1, 30), e('study', 0, 50)]), 20);
  assert.equal(computeDebt([]), 0);
});

test('today totals use Warsaw day', () => {
  // 23:30 UTC on 23 Oct is already 24 Oct in Warsaw (UTC+2)
  const lateUtc = { kind: 'dota', start_ts: Date.UTC(2026, 9, 23, 23, 30) / 1000, minutes: 35 };
  assert.equal(day(lateUtc.start_ts), '2026-10-24');
  assert.deepEqual(todayTotals([lateUtc, e('dota', 1, 10)], now), { dotaToday: 35, studyToday: 0 });
});

test('streak counts covered days, skips idle days, tolerates unfinished today', () => {
  const entries = [
    e('dota', 0, 60), e('study', 0, 10),   // today: not covered yet, doesn't break
    e('dota', 1, 30), e('study', 1, 30),   // ok
    /* 2 days ago: idle, skipped */
    e('study', 3, 20),                     // study only: ok
    e('dota', 4, 50), e('study', 4, 10),   // fail -> stop
    e('study', 5, 99),
  ];
  assert.equal(computeStreak(entries, now), 2);
  assert.equal(computeStreak([...entries, e('study', 0, 50)], now), 3);
});
