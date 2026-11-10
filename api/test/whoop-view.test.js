/* The WHOOP normaliser: a port of the owner's dashboard (whoop-dashboard src/data.js `normalize`),
 * so the days and workouts on the phone are dated exactly as WHOOP's own dashboard dates them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { whoopView } from '../whoop-view.js';

const NOW = new Date('2026-11-09T18:00:00Z');
const EMPTY = { cycles: [], recoveries: [], sleeps: [], workouts: [] };
const raw = (o = {}) => ({ ...EMPTY, ...o });
const view = (o, opts = {}) => whoopView(raw(o), { now: NOW, ...opts });
const day = (v, d) => v.days.find(x => x.d === d);

// One WHOOP v2 day: the cycle starts the evening before, the main sleep ends the morning of `wake`.
const cycle = (id, start, over = {}) => ({ id, start, end: null, timezone_offset: '-05:00', score_state: 'SCORED', score: { strain: 12.4 }, ...over });
const sleep = (id, cycleId, start, end, over = {}) => ({ id, cycle_id: cycleId, nap: false, start, end, timezone_offset: '-05:00', score_state: 'SCORED', score: {}, ...over });
const rec = (cycleId, sleepId, over = {}) => ({ cycle_id: cycleId, sleep_id: sleepId, score_state: 'SCORED', score: { recovery_score: 72, hrv_rmssd_milli: 61.5, resting_heart_rate: 52, user_calibrating: false }, ...over });

// Cycle 1 starts the evening of Nov 7 (local) and its main sleep ends the morning of Nov 8.
const base = () => ({
  cycles: [cycle(1, '2026-11-08T03:00:00Z')],
  sleeps: [sleep('s1', 1, '2026-11-08T03:00:00Z', '2026-11-08T11:00:00Z')],
  recoveries: [rec(1, 's1')],
  workouts: [],
});

test('normalize: only SCORED records yield values; others are null', () => {
  const b = base();
  b.recoveries[0].score_state = 'PENDING_SCORE';
  b.cycles[0].score_state = 'UNSCORABLE';
  const d = day(view(b), '2026-11-08');
  assert.equal(d.recovery, null);
  assert.equal(d.hrv, null);
  assert.equal(d.rhr, null);
  assert.equal(d.strain, null);
  assert.equal(d.calibrating, false);
  const ok = day(view(base()), '2026-11-08');
  assert.deepEqual(ok, { d: '2026-11-08', recovery: 72, hrv: 61.5, rhr: 52, calibrating: false, strain: 12.4 });
});

test('normalize: zero stays zero, never null (number() helper)', () => {
  const b = base();
  Object.assign(b.recoveries[0].score, { recovery_score: 0, hrv_rmssd_milli: 0, resting_heart_rate: 0 });
  b.cycles[0].score.strain = 0;
  b.workouts = [{ id: 'w', sport_name: 'running', start: '2026-11-08T16:00:00Z', end: '2026-11-08T16:30:00Z', timezone_offset: '-05:00', score_state: 'SCORED', score: { strain: 0, average_heart_rate: 0, kilojoule: 0 } }];
  const v = view(b);
  assert.deepEqual(day(v, '2026-11-08'), { d: '2026-11-08', recovery: 0, hrv: 0, rhr: 0, calibrating: false, strain: 0 });
  assert.deepEqual([v.workouts[0].strain, v.workouts[0].avgHr, v.workouts[0].kcal], [0, 0, 0]);
});

test('normalize: calibrating is true only for user_calibrating === true', () => {
  const b = base();
  b.recoveries[0].score.user_calibrating = true;
  assert.equal(day(view(b), '2026-11-08').calibrating, true);
});

test('normalize: a day is the sleep\'s local wake date, using the sleep\'s own timezone_offset', () => {
  // 02:30Z on Nov 8 is Nov 7 21:30 at -05:00, so UTC would say Nov 8 but the local wake date is Nov 7.
  const b = base();
  b.sleeps[0].end = '2026-11-08T02:30:00Z';
  assert.equal(day(view(b), '2026-11-07').recovery, 72);
  assert.equal(day(view(b), '2026-11-08').recovery, null);
  // The sleep's offset wins over the cycle's: +05:30 pushes 23:30Z on Nov 7 into Nov 8.
  const c = base();
  Object.assign(c.sleeps[0], { end: '2026-11-07T23:30:00Z', timezone_offset: '+05:30' });
  assert.equal(day(view(c), '2026-11-08').recovery, 72);
  // Z is accepted as +00:00.
  const z = base();
  Object.assign(z.sleeps[0], { end: '2026-11-08T01:00:00Z', timezone_offset: 'Z' });
  assert.equal(day(view(z), '2026-11-08').recovery, 72);
});

test('normalize: naps never date a cycle; the recovery\'s explicit sleep_id wins', () => {
  const b = base();
  b.sleeps.unshift(sleep('nap', 1, '2026-11-07T19:00:00Z', '2026-11-07T20:00:00Z', { nap: true }));
  const v = view(b);
  assert.equal(day(v, '2026-11-08').recovery, 72);
  assert.equal(day(v, '2026-11-07').recovery, null);
  // A recovery pointing at a nap has no sleep, so the cycle-start fallback dates it (Nov 7 22:00 local).
  const n = base();
  n.sleeps = [sleep('nap', 1, '2026-11-08T19:00:00Z', '2026-11-08T20:00:00Z', { nap: true })];
  n.recoveries = [rec(1, 'nap')];
  assert.equal(day(view(n), '2026-11-07').recovery, 72);
});

test('normalize: without a recovery the cycle\'s earliest non-nap sleep dates it', () => {
  const b = base();
  b.recoveries = [];
  b.sleeps.unshift(sleep('nap', 1, '2026-11-07T19:00:00Z', '2026-11-07T20:00:00Z', { nap: true }));
  const v = view(b);
  assert.equal(day(v, '2026-11-08').strain, 12.4);
  assert.equal(day(v, '2026-11-07').strain, null);
});

test('normalize: with no sleep at all the cycle start date (its own offset) is the fallback', () => {
  // 03:00Z at -05:00 is Nov 7 22:00 local.
  const b = base();
  b.sleeps = [];
  const v = view(b);
  assert.equal(day(v, '2026-11-07').strain, 12.4);
  assert.equal(day(v, '2026-11-07').recovery, 72);
  assert.equal(day(v, '2026-11-08').strain, null);
});

test('normalize: when two cycles share a date the latest cycle start wins', () => {
  const b = base();
  b.cycles.push(cycle(2, '2026-11-08T14:00:00Z', { score: { strain: 4.2 } }));
  b.sleeps.push(sleep('s2', 2, '2026-11-08T14:00:00Z', '2026-11-08T15:00:00Z'));
  b.recoveries.push(rec(2, 's2', { score: { recovery_score: 33, hrv_rmssd_milli: 40, resting_heart_rate: 60, user_calibrating: false } }));
  const d = day(view(b), '2026-11-08');
  assert.equal(d.strain, 4.2);
  assert.equal(d.recovery, 33);
  // Input order cannot change the winner.
  b.cycles.reverse(); b.sleeps.reverse(); b.recoveries.reverse();
  assert.equal(day(view(b), '2026-11-08').strain, 4.2);
});

test('normalize: strain is the cycle\'s own strain; workout strain is never summed into it', () => {
  const b = base();
  b.workouts = [
    { id: 'a', sport_name: 'running', start: '2026-11-08T15:00:00Z', end: '2026-11-08T16:00:00Z', timezone_offset: '-05:00', score_state: 'SCORED', score: { strain: 9.1, average_heart_rate: 150, kilojoule: 2000 } },
    { id: 'b', sport_name: 'cycling', start: '2026-11-08T18:00:00Z', end: '2026-11-08T19:00:00Z', timezone_offset: '-05:00', score_state: 'SCORED', score: { strain: 7.7, average_heart_rate: 140, kilojoule: 1500 } },
  ];
  assert.equal(day(view(b), '2026-11-08').strain, 12.4);
});

test('normalize: workouts are dated by their own local start and listed newest first', () => {
  const w = (id, start, offset, over = {}) => ({ id, sport_name: 'running', start, end: null, timezone_offset: offset, score_state: 'SCORED', score: { strain: 5, average_heart_rate: 120, kilojoule: 418.4 }, ...over });
  const v = view({ workouts: [
    w('early', '2026-11-08T04:00:00Z', '-05:00'),   // Nov 7 23:00 local
    w('late', '2026-11-08T17:00:00Z', '-05:00'),    // Nov 8 12:00 local
    w('ist', '2026-11-07T23:00:00Z', '+05:30'),     // Nov 8 04:30 local
  ] });
  assert.deepEqual(v.workouts.map(x => [x.start, x.d]), [
    ['2026-11-08T17:00:00Z', '2026-11-08'],
    ['2026-11-08T04:00:00Z', '2026-11-07'],
    ['2026-11-07T23:00:00Z', '2026-11-08'],
  ]);
});

test('normalize: workout kcal = kilojoule / 4.184 and minutes = (end - start) / 60000, both rounded', () => {
  const b = { workouts: [{ id: 'a', sport_name: 'strength training', start: '2026-11-08T16:00:00Z', end: '2026-11-08T16:47:40Z', timezone_offset: '-05:00', score_state: 'SCORED', score: { strain: 8.46, average_heart_rate: 133, kilojoule: 1800 } }] };
  assert.deepEqual(view(b).workouts, [{ d: '2026-11-08', sport: 'strength training', start: '2026-11-08T16:00:00Z', minutes: 48, strain: 8.46, avgHr: 133, kcal: 430 }]);
});

test('normalize: an unscored workout keeps sport, start and minutes but has null scores; a missing sport is "Workout"', () => {
  const b = { workouts: [{ id: 'a', start: '2026-11-08T16:00:00Z', end: '2026-11-08T16:30:00Z', timezone_offset: '-05:00', score_state: 'PENDING_SCORE' }] };
  assert.deepEqual(view(b).workouts, [{ d: '2026-11-08', sport: 'Workout', start: '2026-11-08T16:00:00Z', minutes: 30, strain: null, avgHr: null, kcal: null }]);
});

test('normalize: a workout with no end has null minutes', () => {
  const b = { workouts: [{ id: 'a', sport_name: 'running', start: '2026-11-08T16:00:00Z', end: null, timezone_offset: '-05:00', score_state: 'SCORED', score: {} }] };
  assert.equal(view(b).workouts[0].minutes, null);
});

test('datesThrough: the window is the last 14 local days ending today, newest first; older records drop out', () => {
  const b = base();
  b.workouts = [
    { id: 'in', sport_name: 'running', start: '2026-10-27T16:00:00Z', end: null, timezone_offset: '-05:00', score_state: 'SCORED', score: {} },
    { id: 'out', sport_name: 'running', start: '2026-10-26T16:00:00Z', end: null, timezone_offset: '-05:00', score_state: 'SCORED', score: {} },
  ];
  const v = view(b);
  assert.equal(v.days.length, 14);
  assert.equal(v.days[0].d, '2026-11-09');
  assert.equal(v.days[13].d, '2026-10-27');
  assert.deepEqual(v.workouts.map(w => w.d), ['2026-10-27']);
  assert.equal(view(b, { days: 3 }).days.length, 3);
});

test('today: the window ends on the local date of the latest record\'s offset, UTC when there are no records', () => {
  // 03:00Z on Nov 10 is still Nov 9 at -05:00.
  const late = new Date('2026-11-10T03:00:00Z');
  assert.equal(whoopView(raw(base()), { now: late }).days[0].d, '2026-11-09');
  assert.equal(whoopView(EMPTY, { now: late }).days[0].d, '2026-11-10');
});

test('normalize: an open cycle (end: null) still yields its day', () => {
  const b = base();
  assert.equal(b.cycles[0].end, null);
  assert.equal(day(view(b), '2026-11-08').strain, 12.4);
});

test('normalize: empty inputs give 14 empty days and no workouts', () => {
  const v = whoopView(EMPTY, { now: NOW });
  assert.equal(v.days.length, 14);
  assert.deepEqual(v.days[0], { d: '2026-11-09', recovery: null, hrv: null, rhr: null, calibrating: false, strain: null });
  assert.deepEqual(v.workouts, []);
});
