# Deploying the BITA Business Management System

Step-by-step deployment guide written for a non-developer. The web app is host-agnostic and runs on either **Netlify Free** or **Vercel Hobby / Pro**, backed by **Supabase**.

---

## Required Environment Variables

Every deployment host needs these environment variables copied from your Supabase project (**Supabase Dashboard → Project Settings → API**) plus your automation and Telegram secrets:

| Variable | Required? | Where to get it / What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **REQUIRED** | Your Supabase Project URL (e.g. `https://abcdefghijklm.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **REQUIRED** | Your Supabase `anon` `public` key (safe for the browser; Row Level Security protects all data). |
| `SUPABASE_SERVICE_ROLE_KEY` | **REQUIRED** (Server-only) | Your Supabase `service_role` `secret` key. **Required** for **"Link a phone"** in Registers, all `/api/field/*` technician mobile endpoints, `/api/reminders/plan`, `/api/telegram/webhook`, and automatic staff login provisioning. Never expose in browser variables. |
| `REMINDERS_CRON_SECRET` | **REQUIRED** (Server-only) | A random secret phrase (for example, 32+ random characters) shared between the web app and your daily payment reminder cron / n8n workflow. |
| `N8N_WEBHOOK_SECRET` | Optional (Server-only) | Shared secret header for n8n intake and automation webhooks. |
| `TELEGRAM_BOT_TOKEN` | Optional (Server-only) | Bot token from `@BotFather` (e.g. `123456789:ABCdef...`) for the BITA Telegram Executive Assistant. |
| `TELEGRAM_BOT_USERNAME` | Optional | Bot handle without `@` (e.g. `bita_executive_bot`), displayed in **Settings → Telegram Executive Bot**. |
| `TELEGRAM_WEBHOOK_SECRET` | Optional (Server-only) | Secret token verified on `POST /api/telegram/webhook`. Use only letters, digits, `-`, and `_` (`[A-Za-z0-9_-]`). |
| `ANTHROPIC_API_KEY` | Optional (Server-only) | Claude API key for AI enquiry extraction (`lib/ai/extract-enquiry.ts`) and conversational Telegram Q&A. |
| `ANTHROPIC_MODEL` | Optional (Server-only) | Overrides the default Claude model (`claude-sonnet-5-5`). |
| `NEXT_PUBLIC_BITA_ADDRESS` | Optional | Overrides the BITA address line on printed quotations. |
| `NEXT_PUBLIC_BITA_CONTACT` | Optional | Overrides the BITA subtitle/contact line on printed quotations. |
| `NEXT_PUBLIC_BITA_GSTIN` | Optional | Displays BITA's GSTIN on printed quotations when set. |

> **Note:** When the server starts a privileged action (such as linking a technician phone, running the field API, or planning reminders), `lib/env.ts` checks that `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set and clearly names any missing variable.

---

## (a) Option A: Deploy on Netlify Free Tier

Netlify's free tier permits commercial business use and supports Next.js 15 App Router out of the box.

1. **Sign in to Netlify:**
   - Go to [app.netlify.com](https://app.netlify.com/) and sign in with the GitHub account that holds `bitasrk275/BITA-Management-System`.
2. **Import the repository:**
   - Click **Add new site → Import an existing project → GitHub**.
   - Select **`bitasrk275/BITA-Management-System`**.
3. **Configure build settings:**
   - **Branch to deploy:** `main` (or `feature/naveen-integration` during preview).
   - **Build command:** `npm run build`
   - **Publish directory:** `.next` (Netlify automatically detects Next.js and enables the Next.js runtime).
4. **Add Environment Variables:**
   - Click **Add environment variables** (or **Site configuration → Environment variables**).
   - Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `REMINDERS_CRON_SECRET` (plus any optional variables from the table above).
5. **Deploy:**
   - Click **Deploy site**. Once the build finishes (2–3 minutes), Netlify gives you a live HTTPS URL (e.g. `https://bita-bms.netlify.app`). You can also attach a custom BITA domain under **Domain management**.

---

## (b) Option B: Deploy on Vercel Hobby / Pro

> **Important note on Vercel terms:** Vercel's free **Hobby** plan is restricted by Vercel's Terms of Service to **personal, non-commercial use only**. For commercial company use at BITA, either use **Netlify Free** (above) or upgrade to **Vercel Pro**. Note that [`vercel.json`](../vercel.json) pins serverless functions to `bom1` (Mumbai, India) so database queries to Supabase Mumbai (`ap-south-1`) stay sub-50ms.

1. **Sign in to Vercel:**
   - Go to [vercel.com](https://vercel.com/) and sign in with GitHub.
2. **Import the project:**
   - Click **Add New… → Project** and click **Import** next to **`bitasrk275/BITA-Management-System`**.
   - Framework Preset is automatically detected as **Next.js**.
3. **Add Environment Variables:**
   - Expand the **Environment Variables** section.
   - Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REMINDERS_CRON_SECRET`, and the Telegram variables (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`).
4. **Deploy:**
   - Click **Deploy**. After ~2 minutes, Vercel provides your live HTTPS URL (e.g. `https://bita-management-system.vercel.app`).

---

## (c) Supabase Production Checklist

Complete these five steps in the [Supabase Dashboard](https://supabase.com/dashboard) before handing the system to BITA staff:

1. **Turn OFF public sign-up (Mandatory):**
   - Go to **Authentication → Providers → Email** (or **Authentication → Sign In / Up**).
   - Turn **OFF** **"Allow new users to sign up"**.
   - *Why:* Only BITA staff accounts created by Management under **Settings → Users** (or in the Supabase dashboard) should be able to sign in.
2. **Enable Leaked-Password Protection (Mandatory):**
   - Go to **Authentication → Attack Protection** (or **Authentication → Policies / Security**).
   - Turn **ON** **"Prevent use of leaked passwords"** (HaveIBeenPwned integration).
3. **Set Auth Site URL and Redirect URLs:**
   - Go to **Authentication → URL Configuration**.
   - Set **Site URL** to your live production URL (e.g. `https://bita-management-system.vercel.app`).
   - Under **Redirect URLs**, add:
     - `https://bita-management-system.vercel.app/**` (or your Netlify / custom domain `https://<your-domain>/**`).
   - Click **Save**.
4. **Copy API Keys into Host Environment Variables:**
   - Go to **Project Settings → API**.
   - Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`.
   - Copy **`anon` `public`** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Reveal and copy **`service_role` `secret`** key → `SUPABASE_SERVICE_ROLE_KEY` (**required** for "Link a phone", `/api/field/*`, Telegram webhook, and payment reminders).
5. **Keep-Alive for Supabase Free Tier:**
   - Free-tier Supabase projects pause automatically if there is zero database traffic for 7 consecutive days.
   - Enabling the daily payment reminders cron below (`POST /api/reminders/plan` once every morning) queries the database daily and automatically prevents the Supabase project from ever pausing.

---

## (d) Daily Payment Reminders & Keep-Alive Cron

The route `POST /api/reminders/plan` scans issued and partly-paid in-app tax invoices (`balance > 0`, `reminders_paused = false`), records due reminders (`-2` days, `0` days, and daily from `+5` days overdue, configurable under **Settings → Reminder Timings**), and returns email payloads for customer contacts marked `receives_invoices = true`.

You can trigger it daily using **either** n8n (to also send the emails automatically) **or** any free scheduler:

### Option 1: n8n Workflow (Plans + Sends Reminder Emails via SMTP)
1. Open your n8n instance and import [`n8n/payment-reminders-email.json`](../n8n/payment-reminders-email.json) (see [`n8n/README.md`](../n8n/README.md)).
2. Set the n8n environment variables:
   - `BITA_APP_URL`: your live app URL (e.g. `https://bita-management-system.vercel.app`)
   - `REMINDERS_CRON_SECRET`: must match `REMINDERS_CRON_SECRET` on Netlify/Vercel
   - `BITA_DEFAULT_INVOICE_MAILBOX`: default sender email address when a customer has no dedicated `mailbox`
3. Attach BITA's SMTP credentials to the **Send Payment Reminder Email (SMTP)** node and toggle the workflow **Active**.

### Option 2: Free Cron (`cron-job.org` or GitHub Actions)
- **Using [cron-job.org](https://cron-job.org) (Free):**
  1. Create a free cron job targeting `https://<your-live-domain>/api/reminders/plan` at **09:30 AM Asia/Kolkata** daily.
  2. Under **Advanced**, set **Request method** to `POST` and add header:
     `x-reminders-cron-secret: <your-REMINDERS_CRON_SECRET>`
- **Using GitHub Actions (`.github/workflows/reminders.yml`):**
  1. In GitHub, open **Settings → Secrets and variables → Actions** and add two Repository Secrets:
     - `BITA_APP_URL` (your live URL, e.g. `https://bita-management-system.vercel.app`)
     - `REMINDERS_CRON_SECRET` (matching the server's `REMINDERS_CRON_SECRET`)
  2. Open [`.github/workflows/reminders.yml`](../.github/workflows/reminders.yml), uncomment the `schedule:` lines (`cron: "0 4 * * *"`), and commit. You can also test it anytime by clicking **Actions → BITA Payment Reminders Cron → Run workflow**.

---

## (e) Building the Technician Android APK Against the Live URL

The technician Android app (`apps/technician/`, Expo SDK 58) reads `EXPO_PUBLIC_API_URL` (defaulting in `apps/technician/src/config.ts` to `https://bita-management-system.vercel.app`) when pairing a phone (`POST /api/field/pair`) and syncing assignments/inspections.

1. Set `EXPO_PUBLIC_API_URL` to your live web app URL (no trailing slash) before building the APK:
   ```bash
   cd apps/technician
   # Either place in apps/technician/.env:
   echo "EXPO_PUBLIC_API_URL=https://bita-management-system.vercel.app" > .env
   ```
2. **Option 1 — Cloud Build via Expo EAS Free Tier:**
   ```bash
   npm install
   npx eas-cli login
   npx eas-cli build --platform android --profile preview
   ```
3. **Option 2 — Local Gradle Build (Android Studio SDK on Windows/macOS/Linux):**
   ```bash
   npx expo prebuild --platform android
   cd android
   ./gradlew assembleRelease
   # Output APK: apps/technician/android/app/build/outputs/apk/release/app-release.apk
   ```
4. Full instructions for BITA's Expo account, Firebase push notification setup (`google-services.json`), and installing the `.apk` on technician phones are in **[`apps/technician/README.md`](../apps/technician/README.md)**. Technicians can also use the browser/PWA companion at **`https://<your-live-domain>/field-app`**.

---

## (f) Telegram Executive Bot Setup (`@BotFather` → Settings → Webhook)

Management users can link their Telegram accounts to receive proactive notifications (report submitted, invoice issued, payment recorded, daily executive digest) and ask live questions (`/status`, `/jobs`, `/invoices`, `/overdue`, `/reports`, `/equipment`, `/schedule`, `/job <job_no>`, or plain-English questions).

1. **Create the Bot under BITA's Telegram Account (`@BotFather`):**
   - Open Telegram on BITA's official management phone/account and message **`@BotFather`**.
   - Send `/newbot`, enter the display name (e.g. `BITA Executive Assistant`), and choose a username ending in `bot` (e.g. `bita_executive_bot`).
   - Copy the HTTP API **Bot Token** returned by `@BotFather`.
2. **Add the 3 Environment Variables on Vercel / Netlify:**
   - `TELEGRAM_BOT_TOKEN`: the token from `@BotFather`.
   - `TELEGRAM_BOT_USERNAME`: the bot username without `@` (e.g. `bita_executive_bot`).
   - `TELEGRAM_WEBHOOK_SECRET`: a random 32-character secret containing **only** letters, digits, underscores, or hyphens (`[A-Za-z0-9_-]`).
   - Redeploy the site so the new environment variables take effect.
3. **Register the Webhook in Settings:**
   - Sign in to the web app as a `management` user and open **Settings (`/settings`) → Telegram Executive Bot**.
   - Click **Register Telegram Webhook** (this calls Telegram's `setWebhook` API pointing to `https://<your-live-domain>/api/telegram/webhook` with your `TELEGRAM_WEBHOOK_SECRET`).
4. **Link Executive Telegram Accounts:**
   - In **Settings (`/settings`) → Telegram Executive Bot**, click **Generate 6-Digit Pairing Code**.
   - Open your bot in Telegram and send `/start <6-digit-code>` (e.g. `/start 482910`).
   - Click **Send Test Digest** in Settings (or send `/status` in Telegram) to confirm live connectivity.

---

## (g) Go-Live Checklist (Before Handing Over to BITA)

Use this final checklist before BITA begins daily production operations:

- [ ] **1. Settings → Company Profile (`/settings`):**
  - Enter BITA's official **Company Name**, **Address**, **PAN**, **GSTIN**, and **Default SAC Code** (`998393`).
  - Enter BITA's official **Bank Details** (Account Name, Bank Name, Branch, Account Number, IFSC Code) so issued Tax and Proforma invoices print the real payment instructions.
  - Set **Invoice Numbering (`invoice_numbering`)**: verify `next_tax_no` (e.g. `5388`), `next_proforma_no`, and `next_credit_note_no` match BITA's current financial-year sequence.
- [ ] **2. Supabase Authentication Hardening:**
  - Confirm **Allow new users to sign up** is **OFF** in **Supabase Dashboard → Authentication → Providers → Email**.
  - Confirm **Prevent use of leaked passwords** is **ON** in **Supabase Dashboard → Authentication → Attack Protection**.
  - Confirm all BITA staff logins and roles (`management`, `office`, `reviewer`) are created under **Settings → Users (`/settings/users`)**.
- [ ] **3. SMTP & Payment Reminders:**
  - Configure BITA's outgoing SMTP credentials in n8n (`n8n/payment-reminders-email.json`) and in **Supabase Dashboard → Authentication → SMTP Settings** (for password reset / invite emails).
  - Verify `REMINDERS_CRON_SECRET` is set and the daily reminder cron (`09:30 AM IST`) is active.
  - Check **Settings → Reminder Timings** (`before_due_days: 2`, `on_due: true`, `overdue_start_days: 5`).
- [ ] **4. Expo & Firebase Under BITA's Account:**
  - Create BITA's own [Expo](https://expo.dev) and [Firebase](https://console.firebase.google.com) accounts.
  - Register Android package `in.bita.field` in Firebase, download `google-services.json`, and upload the Firebase FCM V1 Service Account key to Expo so technicians receive push notifications when assigned to a job.
- [ ] **5. Android APK Distribution & Technician Phone Pairing:**
  - Distribute `BITA-Technician.apk` to BITA's field technicians and install it on their Android phones (or bookmark `https://<your-live-domain>/field-app` on their phone browser).
  - In **Registers → People (`/registers`)**, generate a 6-digit pairing code for each technician and verify their phone links and loads assigned jobs.
- [ ] **6. Telegram Executive Bot Verification:**
  - Confirm `@BotFather` bot is owned by BITA's management account, webhook is registered in **Settings (`/settings`)**, and management phones are linked via `/start <code>`.
