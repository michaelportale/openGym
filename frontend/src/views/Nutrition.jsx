import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import {
  DAY_TYPES, NUTRIENTS, TARGET_KEYS, canLogNutrition, clearNutritionDay, isLoggedDay,
  nutritionDayOf, nutritionHistory, nutritionInputError, readSupplements, readTargets,
  withNutritionDay, withSupplement, withSupplementTick, withTarget, withoutSupplement,
} from '../lib/nutrition.js'
import { fmtDate, fmtNum, todayISO, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField, Section, Segmented, TextArea, TextField } from '../components/ui.jsx'
import { bwSheet, confirmSheet } from '../sheets.jsx'
import NutritionWeek from '../components/NutritionWeek.jsx'

const update = (fn, ...rest) => useStore.getState().update(fn, ...rest)
const toast = message => useUI.getState().toast(message)

// Copy lives in literal t() calls here (not in lib/nutrition.js) so check-source-strings sees it.
const NUTRIENT_NAME = { kcal: () => t('Calories'), protein: () => t('Protein'), carbs: () => t('Carbs'), fat: () => t('Fat'), fiber: () => t('Fiber') }
const unitOf = key => (key === 'kcal' ? t('kcal') : t('g'))
const DAY_TYPE_NAME = { training: () => t('Training day'), rest: () => t('Rest day') }
const ERROR_COPY = {
  'Fill in all five totals.': () => t('Fill in all five totals.'),
  'One of the totals is out of range.': () => t('One of the totals is out of range.'),
  'Choose training day or rest day.': () => t('Choose training day or rest day.'),
}
const amount = (key, v) => `${fmtNum(v)} ${unitOf(key)}`

// A new day starts as a training day when a workout is logged on it, a rest day otherwise.
const guessDayType = (S, iso) => ((S.workouts || []).some(w => w?.d === iso) ? 'training' : 'rest')

function formFor(S, iso) {
  const day = nutritionDayOf(S, iso)
  const out = { dayType: day?.dayType || guessDayType(S, iso), note: day?.note || '' }
  for (const k of NUTRIENTS) out[k] = day?.[k] ?? null
  return out
}

/* ============================ log a day ============================ */
function DayLog({ initialDate, close }) {
  const S = useStore(s => s.S)
  const [date, setDate] = useState(initialDate || todayISO())
  const [values, setValues] = useState(() => formFor(S, initialDate || todayISO()))
  const existing = isLoggedDay(nutritionDayOf(S, date))
  const pickDate = iso => { setDate(iso); if (canLogNutrition(iso)) setValues(formFor(S, iso)) }
  const set = (k, v) => setValues(cur => ({ ...cur, [k]: v }))

  const save = () => {
    if (!canLogNutrition(date)) { toast(t('Choose a valid date')); return }
    const err = nutritionInputError(values)
    if (err) { toast(ERROR_COPY[err]()); return }
    update(s => { s.nutritionDays = withNutritionDay(s.nutritionDays, date, values) })
    close()
    toast(t('Day saved'))
  }

  return <>
    <h3>{existing ? t('Edit day') : t('Log a day')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t("The day's totals. All five are needed for the day to count.")}</div>
    <label className="measure-date">
      <span>{t('Date')}</span>
      <input className="field" type="date" value={date} max={todayISO()} onChange={e => pickDate(e.target.value)} />
    </label>
    <div className="nutri-type">
      <Segmented value={values.dayType} onChange={v => set('dayType', v)}
        options={DAY_TYPES.map(type => ({ value: type, label: DAY_TYPE_NAME[type]() }))} />
    </div>
    <div className="measure-form">
      {NUTRIENTS.map(k => <label className="measure-field" key={k}>
        <span>{NUTRIENT_NAME[k]()}</span>
        <span className="measure-input">
          <NumberField nullable decimal={k !== 'kcal'} value={values[k]} onChange={v => set(k, v)} aria-label={NUTRIENT_NAME[k]()} />
          <i>{unitOf(k)}</i>
        </span>
      </label>)}
    </div>
    <label className="measure-date" style={{ marginTop: 14 }}>
      <span>{t('Note')} · {t('Optional')}</span>
      <TextArea value={values.note} maxLength={500} rows={2} onChange={e => set('note', e.target.value)} />
    </label>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export function nutritionLogSheet(date = null) {
  return useUI.getState().openSheet(close => <DayLog initialDate={date} close={close} />)
}

/* ============================ targets and supplements ============================ */
function TargetsAndSupplements({ close }) {
  const S = useStore(s => s.S)
  const targets = readTargets(S.nutritionTargets)
  const supplements = readSupplements(S.supplements)
  const [name, setName] = useState('')
  const setTarget = (type, key, v) => update(s => { s.nutritionTargets = withTarget(s.nutritionTargets, type, key, v) })
  // The list is built inside update() from the stored copy, not from this render's, so a
  // supplement that arrived from another device since the sheet opened is kept. The check runs on
  // the same stored copy first, so a refused name doesn't write (and sync) anything.
  const add = () => {
    if (!withSupplement(useStore.getState().S.supplements, name, 'check')) { if (name.trim()) toast(t('That supplement is already on the list.')); return }
    const id = uid()
    update(s => { s.supplements = withSupplement(s.supplements, name, id) || s.supplements })
    setName('')
  }
  const remove = id => update(s => { s.supplements = withoutSupplement(s.supplements, id) })
  return <>
    <h3>{t('Targets and supplements')}</h3>
    {DAY_TYPES.map(type => <Section key={type} className="measure-options"
      title={type === 'training' ? t('Training day targets') : t('Rest day targets')}
      footer={type === 'rest' ? t('Leave a field empty for no target.') : null}>
      <div className="measure-form nutri-targets">
        {TARGET_KEYS.map(k => <label className="measure-field" key={k}>
          <span>{NUTRIENT_NAME[k]()}</span>
          <span className="measure-input">
            <NumberField nullable decimal={k !== 'kcal'} value={targets[type][k]} onChange={v => setTarget(type, k, v)}
              aria-label={`${type === 'training' ? t('Training day') : t('Rest day')} · ${NUTRIENT_NAME[k]()}`} />
            <i>{unitOf(k)}</i>
          </span>
        </label>)}
      </div>
    </Section>)}
    <Section title={t('Supplements')} className="measure-options"
      footer={supplements.length ? t('Removing one keeps the days it was ticked.') : t('Add the supplements you take, then tick them off each day.')}>
      {supplements.map(x => <div className="lrow" key={x.id}>
        <span className="lrow-m"><span className="lrow-t">{x.name}</span></span>
        <button className="iconbtn" style={{ color: 'var(--danger)' }} onClick={() => remove(x.id)} aria-label={t('Remove {0}', x.name)}><Icon name="trash" /></button>
      </div>)}
    </Section>
    <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
      <TextField value={name} maxLength={60} placeholder={t('Supplement name')} aria-label={t('Supplement name')}
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
      <Button icon="plus" onClick={add} disabled={!name.trim()}>{t('Add')}</Button>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export function nutritionSettingsSheet() {
  return useUI.getState().openSheet(close => <TargetsAndSupplements close={close} />)
}

/* ============================ the screen ============================ */
function DayRow({ S, iso, supplements }) {
  const day = nutritionDayOf(S, iso)
  const logged = isLoggedDay(day)
  const ticked = day.supps.filter(id => supplements.some(x => x.id === id)).length
  const clear = () => confirmSheet({
    title: t('Clear this day?'),
    message: t('Removes the totals and note logged on {0}. Supplement ticks stay.', fmtDate(iso, true)),
    confirmText: t('Clear'), danger: true,
    onConfirm: () => { update(s => { s.nutritionDays = clearNutritionDay(s.nutritionDays, iso) }); toast(t('Day cleared')) },
  })
  return <div className="card nutri-day" data-day={iso}>
    <div className="row between">
      <div style={{ minWidth: 0 }}>
        <b>{fmtDate(iso, true)}</b>
        <div className="small dim" style={{ marginTop: 2 }}>
          {logged ? DAY_TYPE_NAME[day.dayType]() : t('No totals logged')}
          {supplements.length > 0 && ` · ${t('Supplements {0}/{1}', ticked, supplements.length)}`}
        </div>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="iconbtn" onClick={() => nutritionLogSheet(iso)} aria-label={t('Edit')}><Icon name="pencil" /></button>
        {logged && <button className="iconbtn" style={{ color: 'var(--danger)' }} onClick={clear} aria-label={t('Clear')}><Icon name="trash" /></button>}
      </div>
    </div>
    {logged && <div className="measure-preview">{NUTRIENTS.map(k => <span key={k}>{NUTRIENT_NAME[k]()} <b>{amount(k, day[k])}</b></span>)}</div>}
    {day.note && <div className="small nutri-note">{day.note}</div>}
  </div>
}

export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const [anchor, setAnchor] = useState(today)
  const supplements = readSupplements(S.supplements)
  const todayDay = nutritionDayOf(S, today)
  const loggedToday = isLoggedDay(todayDay)
  const ticks = new Set(todayDay?.supps || [])
  const history = useMemo(() => nutritionHistory(S).slice(0, 14), [S])
  // Today is read when the box is ticked or Log is tapped, not when the screen last rendered: a
  // tap just after midnight lands on the new day.
  const tick = (id, on) => update(s => { s.nutritionDays = withSupplementTick(s.nutritionDays, todayISO(), id, on) })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Nutrition')}</h1><div className="sub">{t('Daily totals, targets and supplements')}</div></div>
      <button className="iconbtn" onClick={nutritionSettingsSheet} aria-label={t('Targets and supplements')}><Icon name="gear" /></button>
    </div>

    <div className="card nutri-today">
      <div className="row between" style={{ gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="muted small">{t('Today')}{loggedToday ? ` · ${DAY_TYPE_NAME[todayDay.dayType]()}` : ''}</div>
          {loggedToday
            ? <div className="big num" style={{ marginTop: 3 }}>{fmtNum(todayDay.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>{t('kcal')}</span></div>
            : <div className="nutri-empty-line">{t('Nothing logged today yet.')}</div>}
        </div>
        <Button size="sm" variant={loggedToday ? 'tinted' : 'primary'} icon={loggedToday ? 'pencil' : 'plus'} onClick={() => nutritionLogSheet(todayISO())}>
          {loggedToday ? t('Edit') : t('Log')}</Button>
      </div>
      {loggedToday && <div className="measure-preview">{NUTRIENTS.filter(k => k !== 'kcal').map(k => <span key={k}>{NUTRIENT_NAME[k]()} <b>{amount(k, todayDay[k])}</b></span>)}</div>}
      <div className="nutri-weigh">
        <Button size="sm" variant="ghost" icon="scale" onClick={() => bwSheet()}>{t('Log weight')}</Button>
      </div>
    </div>

    <NutritionWeek S={S} anchor={anchor} setAnchor={setAnchor} onLog={() => nutritionLogSheet()} />

    <div className="card nutri-supps">
      <h2 style={{ margin: '0 0 6px' }}>{t('Supplements')}</h2>
      {supplements.length ? <div className="nutri-checks">{supplements.map(x => <label className="nutri-check" key={x.id}>
        <Check checked={ticks.has(x.id)} onChange={on => tick(x.id, on)} label={x.name} />
        <span>{x.name}</span>
      </label>)}</div> : <div className="empty-cta">
        <p>{t('Add the supplements you take, then tick them off each day.')}</p>
        <Button className="empty-cta-btn" icon="plus" onClick={nutritionSettingsSheet}>{t('Add supplements')}</Button>
      </div>}
    </div>

    <h4 className="sec" style={{ margin: '18px 2px 10px' }}>{t('Recent days')}</h4>
    {history.length ? <div className="list">{history.map(iso => <DayRow key={iso} S={S} iso={iso} supplements={supplements} />)}</div>
      : <div className="empty small">{t('Days you log show here, newest first.')}
        <div><Button size="sm" className="empty-cta-btn" icon="plus" onClick={() => nutritionLogSheet()}>{t('Log your first day')}</Button></div></div>}
  </div>
}
