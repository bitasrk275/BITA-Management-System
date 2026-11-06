# BITA Field Technician Mobile App (Android)

Android application for BITA technicians on site, replacing paper field sheets and connecting directly to the BITA Business Management System.

Built with **React Native / Expo** and **TypeScript** per the contract in `docs/FIELD_APP.md` and `DESIGN.md`.

---

## 1. How It Works (No Technician Passwords)

1. **Office Pairing**: Management goes to **Registers → People → [Technician] → "Link a phone"**. The server generates a fresh 6-digit numeric pairing code valid for 15 minutes.
2. **Device Linking**: The technician opens the app, types the 6-digit code, and taps **Link phone**. The app redeems the code via `POST /api/field/pair`, receives a unique `deviceId` and cryptographically random 32-byte secret, and stores them in hardware-backed `expo-secure-store`.
3. **Session & Offline Access**: All future API requests include `Authorization: Bearer <deviceId>.<secret>`. The app caches assigned jobs and draft reports locally in offline storage so technicians can view equipment serial numbers, standards, and enter readings without mobile reception.
4. **Instant Revocation**: If a phone is lost or replaced, management clicks **Revoke** on the staff page. Any subsequent request from that phone is immediately rejected with HTTP 401, returning the app to the link screen.

---

## 2. Screens

1. **Link this phone**: 6-digit pairing code entry with IP rate limit protection (5 attempts/min).
2. **My jobs**: Lists upcoming, in-progress, and completed assignments with pull-to-refresh and offline indicator.
3. **Job details**: Customer name, site address, scope of work, assigned equipment (with model, serial number, and calibration due date), plus action buttons.
4. **Start work**: Records technician arrival timestamp on site (`assignments.started_at`).
5. **Report form**: Dynamic inspection form driven by BITA's method definitions (UT, MPT, DPT). Shows fixed fields, dropdowns with **Others** free-text, type-in parameters, missing required fields highlighting, camera photo attachment (up to 6 MB), and **Save draft** / **Submit report**.
6. **Report a problem**: Direct dispatch to the office for site delays, broken equipment, safety issues, or medical leave.

---

## 3. How Naveen Builds and Installs the APK

### Option A: Cloud APK Build with EAS Build (Recommended & Free)

1. Open a terminal in `apps/technician/`:
   ```bash
   cd apps/technician
   npm install
   ```

2. Log in or create a free Expo account:
   ```bash
   npx eas login
   ```

3. Build an installable `.apk` file:
   ```bash
   npx eas build --platform android --profile preview
   ```
   *(EAS compiles the native Android project in the cloud using the `preview` profile in `eas.json` which outputs an `.apk` file instead of an app bundle).*

4. **Installation on Technician Phone**:
   - When the build finishes, EAS prints a direct download link and QR code.
   - On the technician's Android phone, open the camera, scan the QR code, download the APK, and tap **Install** (enable "Install unknown apps" in Android settings if prompted).

### Option B: Local Android Build (Requires Android Studio / SDK)

```bash
cd apps/technician
npx expo run:android --variant release
```
The APK will be generated under `apps/technician/android/app/build/outputs/apk/release/app-release.apk`.

---

## 4. Push Notification Setup (Firebase Project Under BITA Google Account)

The app works fully offline and online without push notifications (using pull-to-refresh on open). To enable automated push notifications when jobs are assigned, Naveen should complete the following one-time setup:

1. **Create Firebase Project**:
   - Go to [Firebase Console](https://console.firebase.google.com/) under BITA's Google account.
   - Click **Add Project** and name it `bita-field-app`.

2. **Add Android App**:
   - Click the Android icon to register an app.
   - Android package name: `in.bita.field` (must match `app.json`).
   - Download the generated `google-services.json` and place it in `apps/technician/google-services.json`.

3. **Link FCM with Expo**:
   - In Firebase Console, go to **Project Settings → Cloud Messaging**.
   - Enable Cloud Messaging API (V1).
   - In your Expo Dashboard under `bita-field` project settings, upload the Firebase Service Account private key JSON under **Credentials → Android → Server Credentials**.
   - The backend `lib/field/notify.ts` will then automatically deliver notifications to all linked technician devices.
