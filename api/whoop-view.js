/* Turns WHOOP v2 records into the days and workouts the phone shows. A pure port of the owner's
 * dashboard (whoop-dashboard src/data.js `normalize`) so dates match it exactly. No clock, no I/O. */
const minute = 60_000;
const number = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const scored = record => (record?.score_state === 'SCORED' ? record.score : null);

function localDate(iso, offset = '+00:00') {
  if (offset === 'Z') offset = '+00:00';
  if (!iso || !/^[+-]\d{2}:\d{2}$/.test(offset)) return null;
  const shift = (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4))) * (offset[0] === '-' ? -1 : 1);
  const time = new Date(iso).getTime() + shift * minute;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function datesThrough(end, days) {
  return Array.from({ length: days }, (_, i) => new Date(Date.parse(`${end}T12:00:00Z`) - i * 86400000).toISOString().slice(0, 10));
}

// The server has no timezone of its own, so "today" is read in the zone the owner's latest record
// was made in (UTC when there are no records), keeping the window edge on their own calendar.
function windowEnd(now, { cycles, sleeps, workouts }) {
  const latest = [...cycles, ...sleeps, ...workouts]
    .filter(r => r?.start && localDate(r.start, r.timezone_offset))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
  return localDate(now.toISOString(), latest?.timezone_offset);
}

export function whoopView({ cycles = [], recoveries = [], sleeps = [], workouts = [] } = {}, { now, days = 14 } = {}) {
  const raw = { cycles, recoveries, sleeps, workouts };
  // A WHOOP cycle starts with sleep, often the previous evening: label it by the main sleep's
  // local wake date, not bedtime.
  const dated = cycles.map(cycle => {
    const recovery = recoveries.find(r => r.cycle_id === cycle.id);
    // An explicit recovery sleep ID is authoritative; never substitute a nap.
    const sleep = recovery
      ? sleeps.find(s => s.id === recovery.sleep_id && !s.nap)
      : sleeps.filter(s => s.cycle_id === cycle.id && !s.nap).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    const wake = sleep && localDate(sleep.end, sleep.timezone_offset ?? cycle.timezone_offset);
    return { cycle, recovery, date: wake ?? localDate(cycle.start, cycle.timezone_offset) };
  });
  const dates = datesThrough(windowEnd(now, raw), days);
  return {
    days: dates.map(d => {
      const { cycle, recovery } = dated.filter(c => c.date === d)
        .sort((a, b) => Date.parse(b.cycle.start) - Date.parse(a.cycle.start))[0] ?? {};
      const r = scored(recovery);
      return {
        d,
        recovery: number(r?.recovery_score),
        hrv: number(r?.hrv_rmssd_milli),
        rhr: number(r?.resting_heart_rate),
        calibrating: r?.user_calibrating === true,
        strain: number(scored(cycle)?.strain),
      };
    }),
    workouts: workouts
      .map(w => ({ w, d: localDate(w.start, w.timezone_offset) }))
      .filter(({ d }) => dates.includes(d))
      .sort((a, b) => Date.parse(b.w.start) - Date.parse(a.w.start))
      .map(({ w, d }) => {
        const s = scored(w);
        const kj = number(s?.kilojoule);
        const ms = w.end ? Math.max(0, Date.parse(w.end) - Date.parse(w.start)) : NaN;
        return {
          d,
          sport: typeof w.sport_name === 'string' ? w.sport_name : 'Workout',
          start: w.start,
          minutes: Number.isFinite(ms) ? Math.round(ms / minute) : null,
          strain: number(s?.strain),
          avgHr: number(s?.average_heart_rate),
          kcal: kj === null ? null : Math.round(kj / 4.184),
        };
      }),
  };
}
