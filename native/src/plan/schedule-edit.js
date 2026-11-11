// The schedule value a Plan edit saves: scheduleMode, rotation, queue, week and dayPlan.
// A rotation edit is built on the queue next-up already replays. A weekday or a date changes one
// sub-key of the maps as stored — replaying those would send a refilled queue nobody asked to
// change. The web helpers mutate their argument, so each edit clones first. The returned value
// carries no _ts, _f or edited. A missing map comes back as {}; a missing scalar as null.
import { format, rotation } from '../shared/training.js'
import { replayFinishes } from '../workout/next-up.js'

const clone = value => JSON.parse(JSON.stringify(value))
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function held(state) {
  const src = state && typeof state === 'object' ? state : {}
  return {
    scheduleMode: src.scheduleMode ?? null,
    rotation: src.rotation == null ? null : clone(src.rotation),
    queue: src.queue == null ? null : clone(src.queue),
    week: src.week == null ? {} : clone(src.week),
    dayPlan: src.dayPlan == null ? {} : clone(src.dayPlan),
  }
}

function todayOf(now) {
  return format.isoOf(new Date(now))
}

function onReplay(state, now, apply) {
  const copy = replayFinishes(state, now)
  apply(copy, todayOf(now))
  return held(copy)
}

function realDay(iso) {
  return ISO_DAY.test(iso) && format.isoOf(new Date(iso + 'T12:00:00')) === iso
}

// today and the next 13 local days. Date strings compare in calendar order.
function inWindow(iso, today) {
  if (!realDay(iso) || !realDay(today)) return false
  const last = new Date(today + 'T12:00:00')
  last.setDate(last.getDate() + 13)
  const end = format.isoOf(last)
  return iso >= today && iso <= end
}

export function switchToWeek(state, now) {
  return onReplay(state, now, (copy, today) => rotation.chooseFixedWeek(copy, today))
}

export function switchToRotation(state, now) {
  return onReplay(state, now, (copy, today) => rotation.chooseRotation(copy, today, now))
}

export function saveLoop(state, ids, label, now) {
  if (!Array.isArray(ids) || ids.length === 0) return null
  return onReplay(state, now, (copy, today) => rotation.saveRotation(copy, ids.slice(), label, today, now))
}

export function startOver(state, { sessionOpen, now } = {}) {
  if (sessionOpen === true) return null
  const copy = replayFinishes(state, now)
  if (!rotation.rotationIds(copy).length) return null
  rotation.startNewPass(copy, todayOf(now), now)
  return held(copy)
}

export function stopLoop(state, now) {
  return onReplay(state, now, (copy, today) => rotation.stopPass(copy, today))
}

// Emptying the loop stops the pass and stays on Rotation, as the web's Plan does, so taking out
// the last routine never throws you onto the weekday grid. saveLoop refuses an empty list.
export function loopEdited(state, ids, label, now) {
  if (!Array.isArray(ids)) return null
  if (ids.length) return saveLoop(state, ids, label, now)
  const value = stopLoop(state, now)
  value.scheduleMode = 'rotation'
  if (value.rotation && typeof value.rotation === 'object' && !Array.isArray(value.rotation)) {
    value.rotation = { ...value.rotation, sequence: [] }
  }
  return value
}

export function setWeekday(state, day, ids) {
  if (!Number.isInteger(day) || day < 0 || day > 6) return null
  const clear = ids == null || (Array.isArray(ids) && ids.length === 0)
  if (!clear && !Array.isArray(ids)) return null
  const value = held(state)
  if (clear) delete value.week[day]
  else value.week[day] = ids.slice()
  return value
}

export function setDate(state, iso, pin, { today } = {}) {
  if (!inWindow(iso, today)) return null
  const clear = pin == null
  const store = pin === 'rest' || (typeof pin === 'string' && pin.length > 0)
  if (!clear && !store) return null
  const value = held(state)
  if (clear) delete value.dayPlan[iso]
  else value.dayPlan[iso] = pin
  return value
}
