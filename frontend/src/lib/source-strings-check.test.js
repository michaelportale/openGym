import { describe, expect, it } from 'vitest'
import { branchKeys } from '../../scripts/check-source-strings.mjs'

describe('the source-string check reads conditional keys', () => {
  it('collects both literal branches of a conditional first argument', () => {
    expect(branchKeys("x = t(on ? 'Pause' : 'Resume')")).toEqual(['Pause', 'Resume'])
    expect(branchKeys("t(a === 1 ? 'Ready' : a === 2 ? 'Recovering' : 'Fatigued')")).toEqual(['Ready', 'Recovering', 'Fatigued'])
    expect(branchKeys('t(n === 1 ? "It\\u2019s one" : "It\'s {0}", n)')).toEqual(['It\\u2019s one', "It's {0}"])
  })
  it('leaves literal calls, later arguments and runtime lookups alone', () => {
    expect(branchKeys("t('Plain')")).toEqual([])
    expect(branchKeys("t('{0} of {1}', a ? 'x' : 'y')")).toEqual([])
    expect(branchKeys('t(NAMES[k]); t(`Hi ${n}`); format(a ? \'no\' : \'nope\')')).toEqual([])
    expect(branchKeys("Intl.DateTimeFormat(a ? 'en' : 'de')")).toEqual([])
  })
})
