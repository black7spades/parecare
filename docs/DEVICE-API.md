# Device API

The device API lets a machine push its own readings straight into a
treatment's observation log. The motivating example: someone who uses a
CPAP machine every night doesn't log that in tablets taken — the machine
reports hours used, events per hour and mask leak, and it can send those
itself (directly, or through a bridge script that reads the machine's SD
card or vendor cloud).

## Concepts

- **Treatment** — a therapy or device on a care profile, e.g. "CPAP
  therapy". Medications are their own tranche; everything else is a
  treatment. Created on the Treatments page or via
  `POST /api/v1/care-profiles/:id/treatments`.
- **Measure** — one thing a session of the treatment records, with its own
  unit and value type (`number`, `text`, or `yes_no`). A treatment defines
  its measures; a CPAP treatment might define "Hours used" in hours and
  "Events per hour" in events.
- **Observation** — one logged session, with one value per measure.
- **Device key** — the credential a machine authenticates with. A key is
  created on one treatment and can only read and write that treatment.

## Creating a device key

On the Treatments page, edit the treatment and use **Device access**, or:

```
POST /api/v1/care-profiles/:id/treatments/:treatmentId/device-keys
Authorization: Bearer <user JWT>
Content-Type: application/json

{ "name": "Bedroom CPAP machine" }
```

The response contains the plain token once — it is stored only as a hash
and cannot be recovered later:

```json
{
  "device_key": { "id": "…", "name": "Bedroom CPAP machine", "token_prefix": "pcd_3f9a2c", "active": true },
  "token": "pcd_3f9a2c…"
}
```

Revoke a key at any time with
`DELETE /api/v1/care-profiles/:id/treatments/:treatmentId/device-keys/:keyId`.

## Authenticating as a device

Send the token as a bearer token. No user session is involved; the key
scopes every request to its one treatment.

```
Authorization: Bearer pcd_3f9a2c…
```

## Discovering the treatment's measures

```
GET /api/v1/device/treatment
```

```json
{
  "treatment": { "id": "…", "name": "CPAP therapy", "active": true },
  "metrics": [
    { "id": "m1…", "name": "Hours used", "unit": "hours", "value_type": "number" },
    { "id": "m2…", "name": "Events per hour", "unit": "events", "value_type": "number" },
    { "id": "m3…", "name": "Mask leak", "unit": "litres per minute", "value_type": "number" }
  ]
}
```

## Pushing a session's readings

```
POST /api/v1/device/observations
Content-Type: application/json

{
  "observed_at": "2026-07-11T06:30:00Z",
  "status": "completed",
  "readings": [
    { "metric": "Hours used", "value": 7.4 },
    { "metric": "Events per hour", "value": 3.1 },
    { "metric": "Mask leak", "value": 12 }
  ]
}
```

- Each reading names its measure by `metric` (exact name, case-insensitive)
  or `metric_id` (from the discovery endpoint).
- `value` must suit the measure's value type: a number for `number`, a
  string for `text`, and a boolean or yes/no string for `yes_no`.
- `observed_at` defaults to now. `status` defaults to `completed`; the
  other statuses are `partial`, `skipped` and `refused`.
- The observation appears in the treatment's history with the device key's
  name as the recorder and its source shown as a device push.

Response:

```json
{ "observation": { "id": "…", "observed_at": "2026-07-11T06:30:00.000Z", "readings": 3 } }
```

## Errors

| Status | Meaning |
| --- | --- |
| 401 | Missing, unknown or revoked key. |
| 400 with `UNKNOWN_METRIC` | A reading names a measure the treatment does not have. |
| 400 with `VALIDATION_ERROR` | The body is malformed or a value does not suit its measure's type. |
