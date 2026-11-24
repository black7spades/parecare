# 04. Test ordered to results to follow up

**Viewpoint:** Managing my own health (Sam)

**Who:** Sam, managing own health. Login me@bench.test.

**Wants to:** Get a blood test done, remember to fast, collect the request form, then see the results at the follow up.

**Must see or do:** Walk-in collection, preparation note, form attached, result recorded and shown at the follow up.

**Plan scenario:** 4

## Steps

1. Add a walk-in blood test with a date and no time.
2. Add preparation instructions with a night before reminder.
3. Attach the request form when creating the test.
4. Record the result and link it to the test.
5. See the result at the follow up visit.
6. "Results to chase" is offered as a next step.

## Baseline (before any fixes)

1. FAIL. It saved at 09:00 on its own. There is no "any time that day".
2. FAIL. Only a Notes box exists.
3. FAIL. No document box on the form.
4. FAIL. No results record exists.
5. FAIL. Nothing to show.
6. PASS. It is in the how-did-it-go list.

## Block 12 re-walk (2026-11-25, 0.55.0)

Step 3 FAIL. A request form uploaded from Attach a document inside the new test form is filed in Documents but not ticked, so the test says Nothing to bring.

## Wave 10 re-walk (2026-11-25, 0.55.1)

Step 3 PASS. A request form uploaded from Attach a document inside the new test form is ticked to bring at once and saved with the test.
