# Science register

Every training rule the native app can show has an entry here. The code registry in
`native/src/science/rules.js` carries the same fields. A test fails if a code entry and its
file disagree.

This is general training information, not medical advice. Citations are only the evidence list
in `docs/sprints/2026-10-30-native-workout-prd.md`. Where that list does not say who was studied,
`population` is `TODO`. A rule with no reviewed source is labeled in plain words (`Convention`,
`Definition`, or another label from the PRD) instead of being given a citation.

The PRD table row "Deload after 3 misses, e1RM formula, rest defaults, increments" is four rules.
Each has its own entry so a later audit can accept or replace one number without touching the others.

Defaults for the open questions on the science PR are in [Decisions](decisions.md). They follow the PRD
and can be overridden. What is done, what is still open, and which populations still need a source
are in [Phase 4 status](phase-4-status.md).

## Fields

| Field | Meaning |
| --- | --- |
| claim | The rule, as decided in the PRD. |
| source | The cited source, or a plain label when there is no study. |
| population | Who was studied, `TODO` when the PRD does not say, or `Not a study`. |
| evidence | How strong the evidence is, in the PRD's words. |
| inference | What we added ourselves. |
| reading | How much of the source has been read. |
| reason | Plain language for a "Why this?" explanation. |

## Rules

| Rule | Entry | Evidence |
| --- | --- | --- |
| Warm-up loads | [Warm-up loads](warmup-loads.md) | Limited: one crossover study, bench result |
| Warm-up volume | [Warm-up volume](warmup-volume.md) | Limited |
| When to prompt | [When to prompt](warmup-prompt.md) | Our inference |
| Warm-up accounting | [Warm-up accounting](warmup-accounting.md) | Definition |
| Injury claims | [Injury claims](warmup-injury.md) | Evidence gap |
| Rep ranges | [Rep ranges](rep-ranges.md) | Abstract only; read in full before citing further |
| Progression | [Progression](double-progression.md) | The one-session trigger is convention |
| Effort | [Effort](effort-proximity.md) | Exploratory, estimated proximity |
| Weekly volume | [Weekly volume](weekly-volume.md) | Unverified |
| Deload after misses | [Deload after misses](deload-after-misses.md) | Convention until audited |
| e1RM formula | [e1RM formula](e1rm-formula.md) | Convention until audited |
| Rest defaults | [Rest defaults](rest-defaults.md) | Convention until audited |
| Load increments | [Load increments](load-increments.md) | Convention until audited |

## Evidence sources

Reading depth is repeated on each entry that uses the source.

1. [The Role of Specific Warm-up during Bench Press and Squat Exercises](https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/). Summary of the full text read. The PRD names the authors as Ribeiro et al.
2. [Warming up to improved performance?](https://sportrxiv.org/index.php/server/preprint/view/559). Preprint summary read; since published, DOI 10.1016/j.smhs.2025.08.002.
3. [Does warming up prevent injury in sport?](https://pubmed.ncbi.nlm.nih.gov/16679062/). Search summary only.
4. [Upper-body warm-up, performance and injury](https://pubmed.ncbi.nlm.nih.gov/25694615/). Search summary only.
5. [Loading recommendations and the repetition continuum](https://doaj.org/article/6d51b905504d46f0873bb43d5d84bf21). Abstract only.
6. [Load versus repetition progression](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/). Summary of the full text read.
7. [Proximity to failure meta-regression](https://x-mol.com/paper/1810175950090465280). Abstract-level only; DOI 10.1007/s40279-024-02069-2.
8. [Resistance training dose-response](https://sponet.de/sponet/Record/4097139?lng=en). Secondary record only.
