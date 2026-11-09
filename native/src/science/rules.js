/**
 * Science register, one entry per training rule named in the native PRD.
 * `docs/science/` is the same register for people. A test fails if the two differ.
 * Citations are only the PRD's evidence list. Population is TODO where that list
 * does not say who was studied.
 *
 * @typedef {Object} ScienceRule
 * @property {string} id
 * @property {string} title
 * @property {string} claim
 * @property {string} reason Plain language for a "Why this?" sheet.
 * @property {string} source Citation, or a plain label when there is no study.
 * @property {string} sourceUrl Empty when the rule has no single cited url.
 * @property {string} population Who was studied, "TODO", or "Not a study".
 * @property {string} evidence Strength of evidence, in the PRD's own words.
 * @property {string} inference What we added ourselves.
 * @property {string} reading How much of the source has been read.
 */

/** @type {readonly string[]} */
export const REQUIRED_FIELDS = ['id', 'title', 'claim', 'reason', 'source', 'population', 'evidence', 'inference', 'reading']

const rule = entry => Object.freeze(entry)

/** @type {Readonly<Record<string, ScienceRule>>} */
export const RULES = Object.freeze({
  'warmup-loads': rule({
    id: 'warmup-loads',
    title: 'Warm-up loads',
    claim: 'Two warm-up sets of 6 reps, at 40% and 80% of the working weight, rounded down to a loadable weight and never below the bar. An 80 lb dumbbell working weight is about 30 and 60.',
    reason: 'The first two sets of a lift are 6 reps at about 40% and 80% of the weight you are about to use, rounded down to a weight you can load, and never below the bar. An 80 lb dumbbell work weight is about 30 and 60. Evidence is limited: one crossover study, and the result is for the bench press.',
    source: 'Ribeiro et al. The Role of Specific Warm-up during Bench Press and Squat Exercises. https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/. Reading depth: summary of the full text read.',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/',
    population: 'TODO',
    evidence: 'Limited: one crossover study, bench result',
    inference: 'The 2 by 6 at 40% and 80% is the product decision taken from that summary. Rounding down onto a loadable weight, and never going below the bar, is our own rule. Native warm-ups use that prescription. When the work weight is at or under the bar, native returns no warm-up sets. The shared helper in frontend still closes half the gap, and this lane does not edit it.',
    reading: 'Summary of the full text read.'
  }),
  'warmup-volume': rule({
    id: 'warmup-volume',
    title: 'Warm-up volume',
    claim: 'More warm-up sets are not assumed to help. The owner can add a set at any time.',
    reason: 'More warm-up sets are not assumed to help. You can still add a set yourself. Evidence is limited: the summary we read found 1-2 sets similar to none before 10RM work.',
    source: 'Warming up to improved performance? https://sportrxiv.org/index.php/server/preprint/view/559. DOI 10.1016/j.smhs.2025.08.002. Reading depth: preprint summary read; since published.',
    sourceUrl: 'https://sportrxiv.org/index.php/server/preprint/view/559',
    population: 'TODO',
    evidence: 'Limited',
    inference: 'We do not add warm-up sets beyond the decided pair on the claim that more would help. Adding a set remains the lifter\'s choice.',
    reading: 'Preprint summary read; since published. DOI 10.1016/j.smhs.2025.08.002.'
  }),
  'warmup-prompt': rule({
    id: 'warmup-prompt',
    title: 'When to prompt',
    claim: 'Prompt a warm-up on the first lift for a muscle group in the session, and not on later lifts for that muscle.',
    reason: 'A warm-up is prompted on the first lift for a muscle group in the session, not on later lifts for that muscle. That timing is our inference. The summary we read supports skipping a warm-up when the load is already near a 10RM. Evidence for the timing itself is thin.',
    source: 'Our inference. Warming up to improved performance? https://sportrxiv.org/index.php/server/preprint/view/559. DOI 10.1016/j.smhs.2025.08.002. Reading depth: preprint summary read; since published.',
    sourceUrl: 'https://sportrxiv.org/index.php/server/preprint/view/559',
    population: 'TODO',
    evidence: 'Our inference',
    inference: 'Prompting only the first lift for a muscle group is our inference from the summary\'s support for skipping loads already near a 10RM. The summary does not itself test that session rule. The muscle group used here is the catalogue body part. A later lift for a new body part is still prompted.',
    reading: 'Preprint summary read; since published. DOI 10.1016/j.smhs.2025.08.002.'
  }),
  'warmup-accounting': rule({
    id: 'warmup-accounting',
    title: 'Warm-up accounting',
    claim: 'Warm-up sets are saved and shown in history and counted in session duration. They are excluded from progression, personal records, estimated 1RM, and volume.',
    reason: 'Warm-up sets are saved and shown in history, and they count toward how long the session lasted. They are left out of progression, personal records, estimated one-rep max, and volume, because a warm-up is priming rather than the work itself.',
    source: 'Definition',
    sourceUrl: '',
    population: 'Not a study',
    evidence: 'Definition',
    inference: 'None. The exclusion is the definition of a warm-up in this app, not a finding from a study.',
    reading: 'Not a study.'
  }),
  'warmup-injury': rule({
    id: 'warmup-injury',
    title: 'Injury claims',
    claim: 'The app makes no claim that warm-ups prevent lifting injuries.',
    reason: 'The app does not claim that warm-ups prevent lifting injuries. One search summary is not enough to say that they do, and another found no upper-body injury studies. This is an evidence gap.',
    source: 'Evidence gap. Does warming up prevent injury in sport? https://pubmed.ncbi.nlm.nih.gov/16679062/. Reading depth: search summary only. Upper-body warm-up, performance and injury. https://pubmed.ncbi.nlm.nih.gov/25694615/. Reading depth: search summary only.',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/16679062/',
    population: 'TODO',
    evidence: 'Evidence gap',
    inference: 'We stay silent. An insufficient source is not a finding that warm-ups prevent injury, and it is not a finding that they do nothing.',
    reading: 'Search summary only, for both sources.'
  }),
  'rep-ranges': rule({
    id: 'rep-ranges',
    title: 'Rep ranges',
    claim: 'Default to the program\'s rep range. The app does not call 8-12 uniquely optimal.',
    reason: 'Reps stay on the range the program already uses. The app does not call 8-12 the uniquely best range. Gains show up across a wide range of loads, but we have only read the abstract, so this is not a stronger claim than that.',
    source: 'Loading recommendations and the repetition continuum. https://doaj.org/article/6d51b905504d46f0873bb43d5d84bf21. Reading depth: abstract only.',
    sourceUrl: 'https://doaj.org/article/6d51b905504d46f0873bb43d5d84bf21',
    population: 'TODO',
    evidence: 'Abstract only; read in full before citing further',
    inference: 'Keeping the program\'s own range, instead of steering every lift to 8-12, is our application of an abstract we have not read in full.',
    reading: 'Abstract only.'
  }),
  'double-progression': rule({
    id: 'double-progression',
    title: 'Progression',
    claim: 'Double progression: when every work set reaches the top of the rep range in one session, raise the weight and return to the bottom of the range.',
    reason: 'When every work set in a session hits the top of the rep range, the weight goes up and the reps return to the bottom of the range. The paper we read supports raising the load or raising the reps. Using a single session as the trigger is our convention, not a finding from that paper.',
    source: 'Load versus repetition progression. https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/. Reading depth: summary of the full text read. The one-session trigger is convention.',
    sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/',
    population: 'TODO',
    evidence: 'The one-session trigger is convention',
    inference: 'The one-session trigger is convention. Native suggestions use double progression when neither the exercise nor the routine names a policy. An explicit policy is kept. The shared web default stays linear because this lane does not edit frontend.',
    reading: 'Summary of the full text read.'
  }),
  'effort-proximity': rule({
    id: 'effort-proximity',
    title: 'Effort',
    claim: 'Optional reps left in the tank on a set. A report of many reps left is shown as far from failure.',
    reason: 'You can log how many reps you had left on a set. A report of many reps left is shown as far from failure. Muscle growth looks better closer to failure, and strength looks similar across a wide range. This is exploratory, and the reps-left number is an estimate of how close the set was.',
    source: 'Proximity to failure meta-regression. https://x-mol.com/paper/1810175950090465280. DOI 10.1007/s40279-024-02069-2. Reading depth: abstract-level only.',
    sourceUrl: 'https://x-mol.com/paper/1810175950090465280',
    population: 'TODO',
    evidence: 'Exploratory, estimated proximity',
    inference: 'Showing an optional per-set estimate, and wording a high number as far from failure, is our display of an abstract-level result. Many reps left means a hand-entered rating above the inherited HARD_RIR of 3. It does not change the next session by itself.',
    reading: 'Abstract-level only. DOI 10.1007/s40279-024-02069-2.'
  }),
  'weekly-volume': rule({
    id: 'weekly-volume',
    title: 'Weekly volume',
    claim: 'No weekly volume targets ship until the primary paper is read.',
    reason: 'No weekly set target is shown. The dose-response paper is known here only through a secondary record, so a number would overstate what we have read.',
    source: 'Resistance training dose-response. https://sponet.de/sponet/Record/4097139?lng=en. Reading depth: secondary record only. Unverified.',
    sourceUrl: 'https://sponet.de/sponet/Record/4097139?lng=en',
    population: 'TODO',
    evidence: 'Unverified',
    inference: 'Shipping no weekly target follows from having only a secondary record. A target number is not ours to add.',
    reading: 'Secondary record only.'
  }),
  'deload-after-misses': rule({
    id: 'deload-after-misses',
    title: 'Deload after misses',
    claim: 'Inherited deload after repeated misses, named in the PRD as deload after 3 misses. Not audited.',
    reason: 'The inherited app can reduce the load after repeated misses. That behavior is convention until it is audited. No source has been reviewed for it.',
    source: 'Convention',
    sourceUrl: '',
    population: 'Not a study',
    evidence: 'Convention until audited',
    inference: 'In frontend/src/lib/progression.js, DELOAD_AFTER is 3 for linear, double, triple, and timed policies, and 1 for Greyskull. The default factor is 0.9. Those are observations of the current engine, not reviewed evidence.',
    reading: 'None reviewed yet.'
  }),
  'e1rm-formula': rule({
    id: 'e1rm-formula',
    title: 'e1RM formula',
    claim: 'Inherited estimated one-rep max formula. Not audited.',
    reason: 'Estimated one-rep max uses the formula the current app already uses. That choice is convention until it is audited. No source for it has been reviewed.',
    source: 'Convention',
    sourceUrl: '',
    population: 'Not a study',
    evidence: 'Convention until audited',
    inference: 'The shared default is Epley, in frontend/src/lib/onerm.js as DEFAULT_FORMULA, with a 12-rep cap for a single formula. A weighted blend of other formulas in that file also exists. No source for the choice is in the PRD evidence list.',
    reading: 'None reviewed yet.'
  }),
  'rest-defaults': rule({
    id: 'rest-defaults',
    title: 'Rest defaults',
    claim: 'Inherited rest defaults. Not audited.',
    reason: 'Rest between sets starts from the app\'s inherited default. That number is convention until it is audited. No source has been reviewed for it.',
    source: 'Convention',
    sourceUrl: '',
    population: 'Not a study',
    evidence: 'Convention until audited',
    inference: 'A new profile starts at 90 seconds of rest and 15 seconds between rest-pause bursts, in frontend/src/store/useStore.js. No source has been reviewed.',
    reading: 'None reviewed yet.'
  }),
  'load-increments': rule({
    id: 'load-increments',
    title: 'Load increments',
    claim: 'Inherited load increments. Not audited.',
    reason: 'The weight step starts from the app\'s inherited default. That step is convention until it is audited. No source has been reviewed for it.',
    source: 'Convention',
    sourceUrl: '',
    population: 'Not a study',
    evidence: 'Convention until audited',
    inference: 'The shared default step is 2.5 kg, or 5 kg for upper legs, lower legs, back, hips, and glutes. In pounds it is 5, or 10 for those body parts. See defaultIncrement in frontend/src/lib/exercises.js. An exercise can override it. No source has been reviewed.',
    reading: 'None reviewed yet.'
  }),
  'bodyweight-trend': rule({
    id: 'bodyweight-trend',
    title: 'Body-weight 7-day average',
    claim: 'The trend line is a rolling mean of the weigh-ins in the 7 days up to each one.',
    reason: 'A single weigh-in moves with water, salt and food. Averaging a week of them shows the direction more steadily.',
    source: 'Definition',
    sourceUrl: '',
    population: 'Not a study',
    evidence: 'Definition',
    inference: 'Computed by bwTrend in frontend/src/lib/bw-trend.js; fewer than 3 weigh-ins show as dots only.',
    reading: 'None needed: a definition.'
  })
})

/**
 * @typedef {Object} WhyThis
 * @property {string} ruleId
 * @property {string} reason
 * @property {string} source
 */

/**
 * A population row is shown only when the register has a real value.
 * TODO and a blank are the placeholders, so they are not a population.
 */
export function shownPopulation(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.toUpperCase() === 'TODO') return null
  return text
}

/** Plain-language explanation for one registered rule. */
export function whyThis(ruleId) {
  const rule = typeof ruleId === 'string' ? RULES[ruleId] : undefined
  if (!rule) throw new Error(`No science register entry for rule "${ruleId}"`)
  const payload = { ruleId: rule.id, reason: rule.reason, source: rule.source }
  const population = shownPopulation(rule.population)
  if (population) payload.population = population
  return payload
}

/** @returns {string[]} Empty when every entry has the required fields. */
export function registryProblems() {
  const problems = []
  for (const [id, entry] of Object.entries(RULES)) {
    if (!entry || entry.id !== id) problems.push(`${id}: id does not match its key`)
    for (const field of REQUIRED_FIELDS) {
      if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') problems.push(`${id}: missing ${field}`)
    }
    if (typeof entry?.sourceUrl !== 'string') problems.push(`${id}: sourceUrl must be a string`)
  }
  return problems
}
