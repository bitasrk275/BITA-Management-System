# BITA Field Technician Mobile App (Android)

Android application for BITA technicians on site, replacing paper field sheets and connecting directly to the BITA Business Management System.

Built with **React Native / Expo** and **TypeScript** per the contract in `docs/FIELD_APP.md` and `DESIGN.md`.

---

## 1. What BITA Must Give / Provide

Before production rollout, BITA needs to provide two accounts (both free tier):

1. **Expo Account (Free Tier)**:
   - Created at [expo.dev](https://expo.dev) under BITA's company email.
   - Used to run cloud APK builds (`eas build --profile preview`) without needing local Android SDK or high-spec hardware.
   - Naveen or office admin logs in once with `npx eas login`.

2. **Firebase Project Under BITA's Google Account**:
   - Created in the [Firebase Console](https://console.firebase.google.com/) using BITA's official Google account.
   - Project name: `bita-field-app`.
   - Android package name: `in.bita.field` (configured in `app.json`).
   - Deliverables required from BITA's Google account:
     - `google-services.json`: placed in `apps/technician/` for push service registration.
     - **Firebase Cloud Messaging (FCM) Service Account Key (JSON)**: exported from Firebase Console (**Project Settings → Service Accounts → Generate new private key**) and uploaded into the Expo dashboard under project credentials.

> **Note:** The app works completely offline and online without push notifications (using auto-refresh and pull-to-refresh on open). Notifications enhance real-time alerting when new jobs are dispatched by the office.

---

## 2. How It Works (No Technician Passwords)

1. **Office Pairing**: Management goes to **Registers → People → [Technician] → "Link a phone"**. The server generates a fresh 6-digit numeric pairing code valid for 15 minutes.
2. **Device Linking**: The technician opens the app, types the 6-digit code, and taps **Link phone**. The app redeems the code via `POST /api/field/pair`, receives a unique `deviceId` and cryptographically random 32-byte secret, and stores them in hardware-backed `expo-secure-store`.
3. **Session & Offline Access**: All future API requests include `Authorization: Bearer <deviceId>.<secret>`. The app caches assigned jobs and draft reports locally in offline storage so technicians can view equipment serial numbers, standards, and enter readings without mobile reception.
4. **Instant Revocation**: If a phone is lost or replaced, management clicks **Revoke** on the staff page. Any subsequent request from that phone is immediately rejected with HTTP 401, returning the app to the link screen.
5. **Submitted Reports Are Read-Only**: Once a report is submitted (`POST /api/field/assignments/:id/report` with `draft=false`), the inspection is locked. Resubmitting returns HTTP 409 (`"This report was already submitted. Ask the office to make changes."`), and the app displays the report in read-only mode.

---

## 3. Screens

1. **Link this phone**: 6-digit pairing code entry with IP rate limit protection (5 attempts/min).
2. **My jobs**: Lists upcoming, in-progress, and completed assignments with pull-to-refresh and offline indicator.
3. **Job details**: Customer name, site address, scope of work, assigned equipment (with model, serial number, and calibration due date), plus action buttons.
4. **Start work**: Records technician arrival timestamp on site (`assignments.started_at`).
5. **Report form**: Dynamic inspection form driven by BITA's method definitions (UT, MPT, DPT). Shows fixed fields, dropdowns with **Others** free-text, type-in parameters, missing required fields highlighting, camera photo attachment (up to 6 MB), and **Save draft** / **Submit report**. Once submitted, inputs become read-only with an informational status banner.
6. **Report a problem**: Direct dispatch to the office for site delays, broken equipment, safety issues, or medical leave.

---

## 4. How Naveen Builds and Installs the APK

### Option A: Cloud APK Build with EAS Build (Recommended & Free Tier)

1. Open a terminal in `apps/technician/`:
   ```bash
   cd apps/technician
   npm install
   ```

2. Log in with BITA's free Expo account:
   ```bash
   npx eas login
   ```

3. Build an installable `.apk` file:
   ```bash
   npx eas build --platform android --profile preview
   ```
   *(EAS compiles the native Android project in the cloud using the `preview` profile in `eas.json` which outputs a standalone `.apk` file instead of an app store bundle).*

4. **Installation on Technician Phone**:
   - When the build finishes (approx. 5–8 minutes), EAS prints a direct download link and QR code in the terminal.
   - On the technician's Android phone, open the camera or browser, scan the QR code or open the download link, download the APK, and tap **Install** (enable "Install unknown apps" in Android settings if prompted).

### Option B: Local Android Build (Requires Android Studio / SDK)

```bash
cd apps/technician
npx expo run:android --variant release
```
The APK will be generated under `apps/technician/android/app/build/outputs/apk/release/app-release.apk`.

---

## 5. Verification Commands

Run these checks before submitting any pull request:

```bash
# In apps/technician:
cd apps/technician
npm run typecheck      # npx tsc --noEmit
npm run lint           # npx eslint .

# At root repository:
npm run lint
npm run typecheck
npm test
npm run build
```
