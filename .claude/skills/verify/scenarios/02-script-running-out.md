# 02. Script running out, repeat, then a GP visit

**Viewpoint:** Daughter caring for her mum (Linda, Dorothy)

**Who:** Linda, caring for Dorothy.

**Wants to:** Notice Metoprolol and Warfarin are nearly out, get a repeat script and reorder from the pharmacy.

**Must see or do:** See days left, who prescribes, the pharmacy phone, and book the GP visit for repeats.

**Plan scenario:** 2

## Steps

1. See which medicines are running low.
2. The low supply alert names who to call.
3. Reorder from the pharmacy.
4. See who prescribes each medicine.
5. See when repeats are due on the list.
6. Book the GP repeat visit from the medicine.
7. Export medicines and import them back with nothing lost.

## Baseline (before any fixes)

1. PASS. Supply shows "about 2 days" and a low supply alert appears.
2. FAIL. The alert says low supply. It has no pharmacy name or number.
3. FAIL. The only button is "Mark as ordered". It flips to "On order" and shows the pharmacy name, no phone or email.
4. FAIL. No prescriber on a medicine.
5. FAIL. Repeats due is stored but is not a column on the medicines table.
6. FAIL. Nothing on a medicine links to booking.
7. FAIL. Repeats due exports as "Mon Nov 23 2026 00:00:00 GMT+1000". Instructions, critical and condition are not in the file.
