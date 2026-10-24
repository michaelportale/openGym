// The Exercises tab's type and equipment filters, in a sheet. The tab keeps one
// chip row (body parts) with a Filters chip at its start; the two rows that used to sit under it
// live here, with the same options, the same "Any" choices and the same fallback, because both
// run lib/library-filter.js. A choice applies as soon as it is tapped, so the list behind the
// sheet is already filtered when it closes.
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { libraryFilter } from '../lib/library-filter.js'
import { exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

export function LibraryFilterSheet({ input, cat, eq, onCat, onEq, close }) {
  const [c, setC] = useState(cat)
  const [e, setE] = useState(eq)
  const r = libraryFilter({ ...input, cat: c, eq: e })
  const pickCat = x => { setC(x); onCat(x) }
  const pickEq = x => { setE(x); onEq(x) }
  return <div className="lib-filter-sheet">
    <h3>{t('Filters')}</h3>
    <div className="small muted lib-filter-count" role="status">{exCount(r.list.length)}</div>
    {r.catOpts.length > 1 && <>
      <h4 className="sec">{t('Type')}</h4>
      <div className="chips lib-filter-chips">
        <button className={'chip nocap' + (!r.catOn ? ' on' : '')} aria-pressed={!r.catOn} onClick={() => pickCat('')}>{t('Any type')}</button>
        {r.catOpts.map(x => <button key={x} className={'chip' + (r.catOn === x ? ' on' : '')} aria-pressed={r.catOn === x} onClick={() => pickCat(x)}>{t(x)}</button>)}
      </div>
    </>}
    {r.eqOpts.length > 1 && <>
      <h4 className="sec">{t('Equipment')}</h4>
      <div className="chips lib-filter-chips">
        <button className={'chip nocap' + (!r.eqOn ? ' on' : '')} aria-pressed={!r.eqOn} onClick={() => pickEq('')}>{t('Any equipment')}</button>
        {r.eqOpts.map(x => <button key={x} className={'chip' + (r.eqOn === x ? ' on' : '')} aria-pressed={r.eqOn === x} onClick={() => pickEq(x)}>{t(x)}</button>)}
      </div>
    </>}
    <div className="lib-filter-actions">
      <Button disabled={!r.catOn && !r.eqOn} onClick={() => { pickCat(''); pickEq('') }}>{t('Reset')}</Button>
      <Button variant="primary" onClick={close}>{t('Done')}</Button>
    </div>
  </div>
}

export const libraryFilterSheet = props =>
  useUI.getState().openSheet(close => <LibraryFilterSheet {...props} close={close} />)
