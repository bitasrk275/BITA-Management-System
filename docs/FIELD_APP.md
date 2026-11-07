# Technician phone app – contract

Technicians use an **Android app**, not the website (D-016). They have **no login**: the office links each phone once with a 6-digit code. The app talks only to the server's `/api/field/*` routes. The server checks the phone's secret and works with the service role, so technicians never touch the database directly.

## Linking a phone

1. In the dashboard (Technicians & equipment → a technician → **Link a phone**), the office creates a code. The server stores `pairing_codes` with `code_hash = sha256(code)`, `expires_at = now + 15 minutes` and `created_by`, and shows the 6 digits **once**.
2. The technician opens the app and types the code. The app calls `POST /api/field/pair`.
3. The server hashes the code and finds an unused, unexpired row. It marks it `used_at` and creates `technician_devices` with a random 32-byte secret, storing only `secret_hash = sha256(secret)`. It returns `{ deviceId, secret }`.
4. The app keeps `deviceId` and `secret` in secure storage (`expo-secure-store`). Every later call sends `Authorization: Bearer <deviceId>.<secret>`.
5. The office can **revoke** a phone (`technician_devices.revoked_at`). A revoked or unknown phone gets `401`, and the app returns to the "Link this phone" screen.

Limits: 5 failed pairing attempts per minute per IP; codes are 6 random digits; a code can be used once.

## Routes (all JSON; all except `/pair` need the device header)

| Method and path | Body | Does |
| --- | --- | --- |
| `POST /api/field/pair` | `{ code, deviceName, pushToken? }` | Links the phone; returns `{ deviceId, secret, technician: { name } }` |
| `PUT /api/field/push-token` | `{ pushToken }` | Saves the phone's notification token |
| `GET /api/field/jobs` | – | This technician's assignments: upcoming, plus the last 14 days. Each has the job no., customer name, site, scope, test methods, notes, equipment (model, serial, calibration due), `acknowledged_at`, `started_at`, `completed_at`, and the inspection status and missing fields |
| `POST /api/field/assignments/:id/acknowledge` | – | Sets `acknowledged_at` |
| `POST /api/field/assignments/:id/start` | – | Sets `started_at` (the "Start work" button); the office sees it |
| `GET /api/field/report-template/:method` | – | The report fields for UT, MPT or DPT from `lib/reports/fields.ts`: kind (fixed / dropdown with Others / type in), options and required |
| `POST /api/field/assignments/:id/report` | `{ method, readings, observations, draft }` | Upserts the `inspections` row for this assignment with `submitted_by` = the technician and `missing_fields = missingFields(method, readings)`. When `draft` is false and nothing required is missing, it sets `submitted_at`, `assignments.completed_at`, and the job to `inspection_done`. Returns the missing fields. If already submitted, returns HTTP 409 (`already submitted`) and locks changes |
| `POST /api/field/assignments/:id/photos` | multipart `file`, `caption`, `kind` (site_photo / defect_photo / drawing) | Stores the file at `documents/jobs/<job id>/<timestamp>-<name>` and adds an `attachments` row with `uploaded_by` = the technician. 6 MB maximum |
| `POST /api/field/messages` | `{ kind, body, jobId? }` | A delay, leave, equipment problem or site issue, saved to `technician_messages` |

Every route checks that the assignment belongs to the calling technician. Otherwise it returns `404`, never another technician's data.

## Notifications

When the office assigns a technician (`app/(office)/jobs/[id]/assign`), the server sends a push notification to that technician's linked phones, "New job: <customer> · <date>", using the Expo push service (free). The code lives in `lib/field/notify.ts`. Android needs a Firebase project for push delivery, created under BITA's own Google account.

## The app (`apps/technician/`)

- Expo (React Native, TypeScript), Android. The APK is built with EAS Build (free tier) or locally with `npx expo run:android`.
- Screens, as in the workflow map: **Link this phone** → **My jobs** → **Job details** → **Start work** → **Report form** (BITA's template: fixed fields shown, dropdowns with an **Others** free-text option, type-in fields; photos; missing required fields highlighted; Save draft / Submit) → **Report a problem**.
- The look follows `DESIGN.md`: white, black main buttons, status dots, big touch targets for use on site.
- The server URL is configurable (`EXPO_PUBLIC_API_URL`), with nothing secret in the app.

## Web screen retirement (D-016)

Technician web screens (`/my-jobs`, `/my-jobs/[assignmentId]`, `/my-jobs/report-issue`) have been retired. Technicians now use exclusively the Android APK. If a technician logs into the web app, `homeFor(["technician"])` directs them to `/technician`, which displays an informational notice instructing them to install the mobile app and request a 6-digit link code from the office. All underlying database security rules (RLS) remain intact.
