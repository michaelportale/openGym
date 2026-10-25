import { queueView } from '../lib/queue.js'
import { effectiveRoutineIds } from '../lib/history.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Home's progress row for a coach week (S.queue) — it stands in for the seven weekday dots
// while a planner-written queue runs the week, because its sessions have no weekday: they are done in
// order, on whatever days you train. One chip per session in slot order; the next undone one
// is lit, and any undone chip starts its own routine, in whatever order the day calls for. A
// done chip is inert: that session is logged. A session pinned to another day (the day sheet,
// S.dayPlan) is not lit and wears a pin and its day instead — it still starts on a tap. Only the
// next chip carries a word ("Up next"); a slot that is neither next nor done is just its name.
// A done chip is the name in the secondary label colour with a success check, not a fade.
// Reads through queueView so the words here and the today row (effectiveRoutineIds →
// queueNext) can never disagree about which is next.
export default function QueueRow({ S, today, onStart, managed }) {
  const v = queueView(S, today)
  if (!v) return null
  const word = { done: t('Done'), next: t('Up next') }
  const next = v.items.find(i => i.state === 'next')
  // With every remaining session pinned to its own day nothing floats, so there is no 'next'
  // chip at all; the status line then names the soonest pinned one with its day.
  const pinned = v.items.filter(i => i.state === 'pinned').sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0))[0]
  // "today" only when the today row really offers it: a 'rest' or routine override for today
  // wins over the queue there (effectiveRoutineIds), and this line must not contradict it.
  const shownToday = !!next && effectiveRoutineIds(S, today, today).includes(next.id)
  // A pass this app manages refills itself (lib/rotation.js) — "ask the coach" and naming a
  // whole week are a planner's copy, wrong for a pass with no coach and no week shape at all.
  const status = v.complete ? (managed ? t('Round complete') : t('Week complete, ask the coach'))
    : v.waiting ? (managed ? t('Next round starts {0}.', fmtDate(v.startsOn, true)) : t('Next week starts {0}', fmtDate(v.startsOn, true)))
    : shownToday ? t('Next: {0}, today', next.name)
    : next ? t('Next: {0}', next.name)
    : t('Next: {0}', pinned.name + ' · ' + fmtDate(pinned.on, true))
  return <div className="queue">
    <div className="row between" style={{ marginBottom: 8 }}>
      {/* Your own loop is called 'Rotation' in the language on screen: its saved name is only ever
          the word itself, which older saves kept in the language the loop was made in. */}
      <div className="small muted" style={{ fontWeight: 500 }}>{managed ? t('Rotation') : v.label}</div>
      {/* Your own loop speaks in rounds, as Plan does; a coach's week keeps its plain count. */}
      <div className="small muted">{managed ? t('{0} of {1} done this round.', v.items.length - v.remaining.length, v.items.length) : `${v.items.length - v.remaining.length} / ${v.items.length}`}</div>
    </div>
    {/* The state word keeps its sentence case ("Up next", as on Plan): .chip capitalizes every
        word for the routine names, which made it "Up Next" here (QA 10-06). A pinned chip's date
        keeps .chip's capitals, so it reads "Seg., 12 out." and not "seg." in Portuguese. */}
    {/* three chips do not fit one phone row and .chips hides its scrollbar — wrap instead */}
    <div className="chips" style={{ flexWrap: 'wrap' }}>
      {v.items.map((i, n) => <button key={n} className={'chip' + (i.state === 'next' ? ' on' : i.state === 'done' ? ' is-done' : '')}
        disabled={i.state === 'done'} onClick={() => onStart(i.id)}
        aria-label={i.state === 'done' ? i.name + ', ' + t('Done') : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {i.state === 'done' && <Icon name="check" />}{i.name}
        {i.state === 'pinned' && <span className="dim row" style={{ gap: 2 }}><Icon name="pin" /><span className="vh">{t('pinned')}</span>{fmtDate(i.on, true)}</span>}
        {i.state === 'next' && <span className="dim qstate">{word.next}</span>}
      </button>)}
    </div>
    <div className="small muted queue-status" style={{ marginTop: 8 }}>{status}</div>
  </div>
}
