# Deploying the BITA Business Management System

Step-by-step deployment guide written for a non-developer. The web app is host-agnostic and runs on either **Netlify Free** or **Vercel Hobby / Pro**, backed by **Supabase**.

---

## Required Environment Variables

Every deployment host needs these environment variables copied from your Supabase project (**Supabase Dashboard → Project Settings → API**) plus a random cron secret:

| Variable | Required? | Where to get it / What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **REQUIRED** | Your Supabase Project URL (e.g. `https://abcdefghijklm.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **REQUIRED** | Your Supabase `anon` `public` key (safe for the browser; Row Level Security protects all data). |
| `SUPABASE_SERVICE_ROLE_KEY` | **REQUIRED** (Server-only) | Your Supabase `service_role` `secret` key. **Required** for **"Link a phone"** in Registers, all `/api/field/*` technician mobile endpoints, `/api/reminders/plan`, and automatic staff login provisioning. Never expose in browser variables. |
| `REMINDERS_CRON_SECRET` | **REQUIRED** (Server-only) | A random secret phrase (for example, 32+ random characters) shared between the web app and your daily payment reminder cron / n8n workflow. |
| `ANTHROPIC_API_KEY` | Optional (Server-only) | Claude API key for AI enquiry extraction (`lib/ai/extract-enquiry.ts`). |
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

## (b) Option B: Deploy on Vercel Hobby

> **Important note on Vercel terms:** Vercel's free **Hobby** plan is restricted by Vercel's Terms of Service to **personal, non-commercial use only**. For commercial company use at BITA, either use **Netlify Free** (above) or upgrade to **Vercel Pro**.

1. **Sign in to Vercel:**
   - Go to [vercel.com](https://vercel.com/) and sign in with GitHub.
2. **Import the project:**
   - Click **Add New… → Project** and click **Import** next to **`bitasrk275/BITA-Management-System`**.
   - Framework Preset is automatically detected as **Next.js**.
3. **Add Environment Variables:**
   - Expand the **Environment Variables** section.
   - Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `REMINDERS_CRON_SECRET`.
4. **Deploy:**
   - Click **Deploy**. After ~2 minutes, Vercel provides your live HTTPS URL (e.g. `https://bita-management-system.vercel.app`).

---

## (c) Supabase Production Checklist

Complete these four steps in the [Supabase Dashboard](https://supabase.com/dashboard) before handing the system to BITA staff:

1. **Turn OFF public sign-up (Mandatory):**
   - Go to **Authentication → Providers → Email** (or **Authentication → Sign In / Up**).
   - Turn **OFF** **"Allow new users to sign up"**.
   - *Why:* Only BITA staff accounts created by Management under **Settings → Users** (or in the Supabase dashboard) should be able to sign in.
2. **Set Auth Site URL and Redirect URLs:**
   - Go to **Authentication → URL Configuration**.
   - Set **Site URL** to your live production URL (e.g. `https://bita-bms.netlify.app`).
   - Under **Redirect URLs**, add:
     - `https://bita-bms.netlify.app/**` (or your Vercel / custom domain `https://<your-domain>/**`).
   - Click **Save**.
3. **Copy API Keys into Host Environment Variables:**
   - Go to **Project Settings → API**.
   - Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`.
   - Copy **`anon` `public`** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Reveal and copy **`service_role` `secret`** key → `SUPABASE_SERVICE_ROLE_KEY` (**required** for "Link a phone", `/api/field/*`, and payment reminders).
4. **Keep-Alive for Supabase Free Tier:**
   - Free-tier Supabase projects pause automatically if there is zero database traffic for 7 consecutive days.
   - Enabling the daily payment reminders cron below (`POST /api/reminders/plan` once every morning) queries the database daily and automatically prevents the Supabase project from ever pausing.

---

## (d) Daily Payment Reminders & Keep-Alive Cron

The route `POST /api/reminders/plan` scans issued and partly-paid in-app tax invoices (`balance > 0`, `reminders_paused = false`), records due reminders (`-2` days, `0` days, and daily from `+5` days overdue), and returns email payloads for customer contacts marked `receives_invoices = true`.

You can trigger it daily using **either** n8n (to also send the emails automatically) **or** any free scheduler:

### Option 1: n8n Workflow (Plans + Sends Reminder Emails via SMTP)
1. Open your n8n instance and import [`n8n/payment-reminders-email.json`](../n8n/payment-reminders-email.json) (see [`n8n/README.md`](../n8n/README.md)).
2. Set the n8n environment variables:
   - `BITA_APP_URL`: your live app URL (e.g. `https://bita-bms.netlify.app`)
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
     - `BITA_APP_URL` (your live URL, e.g. `https://bita-bms.netlify.app`)
     - `REMINDERS_CRON_SECRET` (matching the server's `REMINDERS_CRON_SECRET`)
  2. Open [`.github/workflows/reminders.yml`](../.github/workflows/reminders.yml), uncomment the `schedule:` lines (`cron: "0 4 * * *"`), and commit. You can also test it anytime by clicking **Actions → BITA Payment Reminders Cron → Run workflow**.

---

## (e) Building the Technician Android APK Against the Live URL

The technician Android app (`apps/technician/`, Expo SDK 58) reads `EXPO_PUBLIC_API_URL` to know which server to connect to when pairing a phone (`POST /api/field/pair`) and syncing assignments/inspections.

1. Set `EXPO_PUBLIC_API_URL` to your live web app URL (no trailing slash) before building the APK:
   ```bash
   cd apps/technician
   # Either place in apps/technician/.env:
   echo "EXPO_PUBLIC_API_URL=https://bita-bms.netlify.app" > .env
   ```
2. Build the installable `.apk` using Expo EAS Free Tier:
   ```bash
   npm install
   npx eas login
   npx eas build --platform android --profile preview
   ```
3. Full instructions for BITA's Expo account, Firebase push notification setup (`google-services.json`), and installing the `.apk` on technician phones are in **[`apps/technician/README.md`](../apps/technician/README.md)**.
