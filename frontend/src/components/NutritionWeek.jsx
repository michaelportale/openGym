// The weekly view on the Nutrition screen: one calendar week (the profile's first day of the
// week), stepped back and forward. Body weight comes from the weigh-in log; the rest from the
// days logged that week (lib/nutrition.js weekSummary).
import { TARGET_KEYS, weekSummary } from '../lib/nutrition.js'
import { fmtDate, fmtNum, isoOf, startOfWeek, todayISO, weekStartOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const unitOf = key => (key === 'kcal' ? t('kcal') : t('g'))
const amount = (key, v) => `${fmtNum(v)} ${unitOf(key)}`

function Tile({ label, value, sub, testId }) {
  return <div className="tile nutri-tile" data-tile={testId}>
    <div className="l">{label}</div>
    <div className="v num">{value}</div>
    {sub && <div className="nutri-sub">{sub}</div>}
  </div>
}

function vsTarget(key, avg, target) {
  if (avg == null) return null
  return target == null ? t('No target set') : t('Target {0}', amount(key, target))
}

export default function NutritionWeek({ S, anchor, setAnchor, onLog }) {
  const ws = weekStartOf(S)
  const today = todayISO()
  const thisWeek = isoOf(startOfWeek(today, ws))
  const w = weekSummary(S, anchor, ws)
  const isCurrent = w.start === thisWeek
  const step = n => { const d = new Date(w.start + 'T12:00:00'); d.setDate(d.getDate() + 7 * n); setAnchor(isoOf(d)) }
  const unit = S.unit
  const empty = !w.logged && !w.weight
  const change = w.weight?.delta
  return <div className="card nutri-week">
    <div className="row between nutri-week-h">
      <button className="iconbtn" onClick={() => step(-1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
      <h2 style={{ margin: 0 }}>{isCurrent ? t('This week') : t('Week of {0}', fmtDate(w.start))}</h2>
      <button className="iconbtn" onClick={() => step(1)} disabled={isCurrent} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
    </div>
    {empty ? <div className="empty-cta">
      <p>{t("Your week's averages show here once you log a day.")}</p>
      {isCurrent && <Button className="empty-cta-btn" icon="plus" onClick={onLog}>{t('Log today')}</Button>}
    </div> : <div className="tiles nutri-tiles">
      <Tile testId="weight" label={t('Average weight')}
        value={w.weight ? `${fmtNum(w.weight.avg)} ${unit}` : '–'}
        sub={!w.weight ? t('No weigh-ins this week') : change == null ? t('No weigh-in last week to compare') : t('{0} vs last week', `${change > 0 ? '+' : change < 0 ? '−' : ''}${fmtNum(Math.abs(change))} ${unit}`)} />
      <Tile testId="logged" label={t('Days logged')} value={`${w.logged}/7`} />
      {TARGET_KEYS.map(k => <Tile key={k} testId={k}
        label={k === 'kcal' ? t('Average calories') : k === 'protein' ? t('Average protein') : t('Average fiber')}
        value={w.avg ? amount(k, w.avg[k]) : '–'} sub={vsTarget(k, w.avg?.[k], w.target[k])} />)}
      <Tile testId="protein-hit" label={t('Protein target reached')}
        value={w.protein.of ? `${w.protein.hit}/${w.protein.of}` : '–'}
        sub={w.protein.of ? null : t('Set a protein target to count this')} />
    </div>}
  </div>
}
