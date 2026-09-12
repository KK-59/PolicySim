# Tests — Kaavya

The verification assertions are not a test suite you run at the end. They run on **every**
simulation (PRD §4.6):

- conservation — no work item vanishes
- Little's Law — L = λW
- agreement with the M/M/1 closed form on a degenerate config
- sane behaviour at slider extremes

Plus the **hour-one sensitivity check**: halve all slots, confirm downstream metrics move.
If nothing moves, stop and fix it before building anything on top.
