# BITA n8n Workflows

This directory contains exportable n8n workflow definitions for the BITA Business Management System.

## `payment-reminders-email.json` — In-App Invoice Payment Reminders (Email Only)

Automates daily payment reminder emails for in-app tax invoices (Decision D-016 / D-017, T37). **Email only — no WhatsApp.**

### Schedule & Eligibility Rules (R35–R37)
- **Eligible Invoices:**
  - `kind = 'tax_invoice'` (proforma invoices are excluded)
  - `status IN ('issued', 'partly_paid')` (draft, paid, and cancelled invoices are excluded)
  - `balance > 0`
  - `reminders_paused = false`
  - `due_date IS NOT NULL`
- **Reminder Cadence:**
  - `before_due`: **2 days before** `due_date`
  - `on_due`: **On** `due_date`
  - Quiet buffer: **1 to 4 days after** `due_date` (no reminder sent)
  - `overdue`: **5th day after** `due_date` and **daily thereafter** until `balance = 0` or `reminders_paused = true`
- **Recipients & Sender Mailbox:**
  - Sent only to customer contacts with `receives_invoices = true` (`sent_to`).
  - Uses the customer's dedicated BITA mailbox (`customers.mailbox`, e.g. TDPS desk) when set, falling back to `BITA_DEFAULT_INVOICE_MAILBOX`.

### Workflow Steps
1. **Daily 09:30 IST Schedule (`n8n-nodes-base.scheduleTrigger`):** Runs at `09:30` `Asia/Kolkata`.
2. **Plan Due Invoice Reminders (`POST /api/reminders/plan`):** Calls the BITA app with `x-reminders-cron-secret`. Inserts idempotent rows into `payment_reminders` (`UNIQUE (invoice_id, scheduled_for)`) and returns the `emails` array with pre-rendered `subject` and `body`.
3. **Split Out Planned Reminder Emails (`n8n-nodes-base.splitOut`):** Emits one item per planned reminder in `emails`.
4. **Has Invoice Contacts (`receives_invoices = true`)? (`n8n-nodes-base.if`):** Skips SMTP dispatch if a customer has no contacts marked `receives_invoices = true`.
5. **Send Payment Reminder Email (`n8n-nodes-base.emailSend`):** Sends the plain-text reminder email via SMTP to `sent_to.join(', ')` from `from_mailbox || BITA_DEFAULT_INVOICE_MAILBOX`.
6. **Mark Reminder Sent in BITA (`PATCH /api/reminders/plan`):** Updates `payment_reminders.sent_at` for the delivered `reminder_id`.

### Required n8n Environment Variables
| Variable | Purpose |
| --- | --- |
| `BITA_APP_URL` | Base URL of the deployed BITA Next.js app (no trailing slash) |
| `REMINDERS_CRON_SECRET` | Shared secret matching `REMINDERS_CRON_SECRET` in the app's `.env.local` |
| `BITA_DEFAULT_INVOICE_MAILBOX` | Default sender email address when `customers.mailbox` is `null` |
