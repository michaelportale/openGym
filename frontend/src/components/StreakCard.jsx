// The rotation streak card (lib/rotation-streak.js) on Home: sessions that kept the loop going,
// rounds completed and rest passes banked. With no rotation or plan the caller keeps the week
// streak card instead. No flame, no accent and no red: a broken streak reads as a fresh start.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { MAX_PASSES, PAUSE_KINDS, ROUND_DAY_OPTIONS, streakLoop } from '../lib/rotation-streak.js'
import Icon from './Icon.jsx'
import { Button, Row } from './ui.jsx'

export const PAUSE_LABEL = { break: 'On a break', sick: 'Sick', injured: 'Injured' }
const weekday = iso => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'short' })
const weekdayLong = iso => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' })

/** The lines the card shows, also joined into its accessible name. */
export function streakLines(st) {
  // "on rotation" only in Rotation mode; a Fixed Week streak counts its planned sessions.
  const unitLabel = st.mode === 'rotation' ? tn('session on rotation', 'sessions on rotation', st.count) : tn('session', 'sessions', st.count)
  const meta = [tn('{0} round', '{0} rounds', st.rounds), tn('{0} rest pass', '{0} rest passes', st.passes)].join(' · ')
  if (st.state === 'zero') return { lead: t('Your streak starts with your first session'), aria: t('Your streak starts with your first session') }
  if (st.state === 'broken') {
    const best = tn('Best: {0} session', 'Best: {0} sessions', st.best)
    return { lead: t('Start a new streak'), best, aria: [t('Start a new streak'), best].join('. ') }
  }
  const pause = st.state === 'paused' ? t('Paused · {0} since {1}', t(PAUSE_LABEL[st.kind]), weekday(st.since)) : null
  const risk = st.state === 'atRisk' ? t('Train by {0} to keep it', weekday(st.deadline)) : null
  const riskLong = st.state === 'atRisk' ? t('Train by {0} to keep it', weekdayLong(st.deadline)) : null
  return { unitLabel, meta, pause, risk, aria: [st.count + ' ' + unitLabel, meta, pause, riskLong].filter(Boolean).join(', ') }
}

export default function StreakCard({ streak: st, startLabel, onStart, onCalendar, summary }) {
  const L = streakLines(st)
  const dots = Math.min(st.rounds, 8)
  return <div className="card streak-card" role="group" aria-label={t('Streak') + ': ' + L.aria}>
    <div className="row between streak-top">
      <div className="streak-kicker">{t('Streak')}</div>
      <div className="row streak-actions">
        <button type="button" className="iconbtn streak-btn" aria-label={t('Streak options')} onClick={() => streakSheet()}><Icon name="more" /></button>
        <button type="button" className="iconbtn streak-btn" aria-label={t('Calendar')} onClick={onCalendar}><Icon name="calendar" /></button>
      </div>
    </div>
    {L.unitLabel ? <>
      <div className={'streak-num tnum' + (st.state === 'paused' ? ' frozen' : '')}>{st.count}</div>
      <div className="streak-label">{L.unitLabel}</div>
      <div className="row streak-meta">
        {dots > 0 && <span className="streak-dots" aria-hidden="true">{Array.from({ length: dots }, (_, i) => <i key={i} />)}</span>}
        <span>{L.meta}</span>
      </div>
      {L.risk && <div className="row streak-risk"><Icon name="hourglass" aria-hidden="true" /><span>{L.risk}</span></div>}
      {L.pause && <div className="streak-pause">{L.pause}</div>}
    </> : <>
      <div className="streak-lead">{L.lead}</div>
      {L.best && <div className="streak-label">{L.best}</div>}
      {onStart && startLabel && <Button className="streak-cta" onClick={onStart}>{t('Start {0}', startLabel)}</Button>}
    </>}
    {summary && <div className="streak-summary">{summary}</div>}
  </div>
}

// The ⋯ menu: pause the streak (or end the pause), and in Rotation mode how long a round takes.
function StreakSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const today = todayISO()
  const paused = S.status && S.status.since
  const pauseAs = kind => { update(s => { s.status = { kind, since: today } }); close() }
  const resume = () => {
    update(s => {
      const p = s.status
      s.pauses = [...(Array.isArray(s.pauses) ? s.pauses : []), { kind: p.kind, since: p.since, until: today }]
      s.status = null
    })
    close()
  }
  const loop = streakLoop(S)
  const rotating = loop?.mode === 'rotation'
  return <>
    <h3>{t('Streak')}</h3>
    <div className="muted small">{t('A pause freezes your streak until you are back. Each finished round banks a rest pass (up to {0}) that covers one long gap.', MAX_PASSES)}</div>
    <div className="list menu-list streak-sheet-list">
      {paused
        ? <Row icon="play" title={t("I'm back")} subtitle={t('Paused · {0} since {1}', t(PAUSE_LABEL[S.status.kind] || PAUSE_LABEL.break), weekday(S.status.since))} onClick={resume} />
        : PAUSE_KINDS.map(k => <Row key={k} icon="pause" title={t(PAUSE_LABEL[k])} onClick={() => pauseAs(k)} />)}
    </div>
    {rotating && <>
      <div className="streak-sheet-h">{t('Aim to finish a round every')}</div>
      <div className="list menu-list streak-sheet-list">
        {ROUND_DAY_OPTIONS.map(n => <Row key={n} title={t('{0} days', n)} accessory={n === loop.P ? 'check' : 'none'}
          onClick={() => update(s => { s.roundDays = n })} />)}
      </div>
    </>}
  </>
}
export const streakSheet = () => useUI.getState().openSheet(close => <StreakSheet close={close} />)
