---
id: deload-after-misses
title: Deload after misses
claim: Inherited deload after repeated misses, named in the PRD as deload after 3 misses. Not audited.
reason: The inherited app can reduce the load after repeated misses. That behavior is convention until it is audited. No source has been reviewed for it.
source: Convention
population: Not a study
evidence: Convention until audited
inference: In frontend/src/lib/progression.js, DELOAD_AFTER is 3 for linear, double, triple, and timed policies, and 1 for Greyskull. The default factor is 0.9. Those are observations of the current engine, not reviewed evidence.
reading: None reviewed yet.
sourceUrl: 
---

The inherited app can reduce the load after repeated misses. That behavior is convention until it is audited. No source has been reviewed for it.

Our own inference: In frontend/src/lib/progression.js, DELOAD_AFTER is 3 for linear, double, triple, and timed policies, and 1 for Greyskull. The default factor is 0.9. Those are observations of the current engine, not reviewed evidence.

General training information, not medical advice. Sources are only those named in the native workout PRD.
