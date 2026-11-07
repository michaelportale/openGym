// Fixture: a future UI file. The audit must fail this without bundling Babel into the app.
export function Screen(ruleId: string) {
  whyThis('not-a-real-rule')
  whyThis(ruleId)
  return null
}
