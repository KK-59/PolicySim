## What this does

<!-- One line. -->

## Owner track

- [ ] Kaavya — engine / worlds / analysis
- [ ] Oriol — integration / agent / live loop
- [ ] Albert — clinical / corpus / sourcing
- [ ] Elsa — interface / delivery

## Contract check

- [ ] This does **not** change `src/contracts/`
- [ ] It does change a contract — agreed in the group chat, and I have told everyone downstream:
      `Params` → Elsa, Albert, Oriol · `Metrics` → Elsa · `Action` → Albert, Elsa

## Before merge

- [ ] Runs against `fixtures/` with no live server
- [ ] Verification assertions still pass (engine changes only)
- [ ] No secrets, no `.env`, no raw snapshot committed
- [ ] Demo still works offline
