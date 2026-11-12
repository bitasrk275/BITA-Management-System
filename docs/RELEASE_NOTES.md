# BITA Business Management System – Release Notes

This document summarizes everything the BITA Business Management System does today for management, office staff, technical reviewers, and field technicians.

---

## End-to-End Workflow in 14 Steps (Enquiry to CA GST Files)

### Step 1: Customer Directory and Contacts
- Maintain a central directory of all client companies with their billing address, GSTIN, state code, payment terms (in days), and whether the client requires a proforma invoice before issuing a purchase order.
- Store multiple contact persons per customer and mark which contacts should receive inspection reports and which should receive invoices and payment reminders.

### Step 2: Customer Enquiries and Email Paste-Assist
- Record incoming enquiries received by email, phone, or in person, and link each enquiry to an existing or newly created customer.
- Paste a customer's enquiry email into the **New enquiry** screen and click **Fill from email** to prefill the matched customer, inspection requirement, standard, component, quantity, site location, and test methods automatically before saving.

### Step 3: Price List (Standard Rate Card)
- Maintain a master rate card of standard inspection services and charges with default rates, units (per piece, per metre, per visit, per day), and SAC code (`998393`).
- Use price-list items to populate quotations and invoices quickly while keeping past invoices unchanged if standard rates are updated later.

### Step 4: Quotations and Rate History
- Draft itemized quotations from an enquiry or directly for a customer, or upload an existing quotation document (PDF or Word) and attach it to the record.
- Search past quoted rates by test method, component, or customer while preparing a new quotation, route quotations for management approval, print on company letterhead, and mark accepted quotations to create a job in one step.

### Step 5: Jobs and Customer Purchase Orders
- Track every inspection engagement under a single financial-year Job ID (`BITA/YY-YY/0001`) from initial enquiry through final payment and closure.
- Record the customer's Purchase Order number, date, PO value, and uploaded PO copy, and automatically warn staff if the total invoiced amount on a job exceeds the customer's PO value.
- Export the complete **Jobs Register** (CSV or Excel workbook) filtered by financial year, month, or customer with the standard inspection notebook columns (date of testing, technician, customer, report numbers, component/serial number, testing details, invoice generated status, invoice numbers, and remarks).

### Step 6: Equipment Register, Calibration Alerts, and Movement Log
- Maintain all inspection instruments, probes, calibration blocks, yokes, and gauges sorted by calibration due date, with private storage for calibration certificates.
- Highlight instruments whose calibration is due within 30 days or already overdue, and record every instrument movement between the office, client sites, and calibration laboratories along with delivery challan numbers and copies.

### Step 7: Employee Register, Qualifications, and Attendance Summary
- Maintain the staff and technician register with roles, qualification certificates by test method and level (`ASNT`, `ISNT`, Level II / Level III), and automatic expiry warnings.
- View each employee's monthly summary of worked days, idle days, and leave days alongside management-only salary records, and upload digital signatures for technical reviewers and signatories.

### Step 8: Interactive Scheduling Calendar and Technician Assignment
- Assign one or more technicians and instruments to a job across single-day or multi-day site visits on a weekly or monthly **Calendar** view, and mark technician leave days and company holidays.
- Automatically check and warn if a selected technician's qualification for the job's test method is expired or missing, or if an instrument is already booked on another job or overdue for calibration.

### Step 9: Technician Phone App and Field Datasheet Entry
- Pair a technician's Android phone using a one-time 6-digit pairing code generated from the web dashboard.
- Technicians see their assigned jobs, tap **Start Work**, fill in the structured inspection datasheet (including the complete 29-field Ultrasonic Testing format with per-customer remembered defaults, dropdown options with **Others**, and component result rows), attach component photos, and submit from the site—with the ability to edit submitted readings until a reviewer approves the report.

### Step 10: Daily Log Book and Site Expenses
- Automatically populate the daily **Log book** from scheduled job assignments showing the date, job number, customer, site location, technicians, and instruments deployed.
- Record itemized job expenses (travel, lodging, food, consumables, or other site costs) against each job so management can compare monthly billed revenue against site expenses.

### Step 11: Report Review, Technical Approval, and Word / PDF Downloads
- Office staff and technical reviewers can review submitted field datasheets, select which site photos to include, refine report fields, or return an incomplete inspection to the technician with a correction note.
- Enforces two safety guards before approval: only a designated Reviewer or Management user can approve a report, and approval is blocked (unless explicitly overridden by management with a recorded reason) if any instrument used on the report had an expired calibration on the date of testing.
- Once approved, the report is locked against further edits, stamped with the company logo, company seal, and the approver's (or default signatory's) digital signature, and can be downloaded as both a print-ready **PDF** and an editable **Word (`.docx`)** document. Every edit, return, and approval is recorded in the report's correction history.

### Step 12: In-House Proforma Invoices, Tax Invoices, Credit Notes, and TDS
- Prepare **Proforma Invoices** (`PI-`) and **Tax Invoices** (`5388` onwards) directly from one or more approved reports or from a job, with automatic intra-state (`CGST 9% + SGST 9%`) or inter-state (`IGST 18%`) calculation based on the customer's GSTIN and place of supply, Indian rupee rounding, and amount in words.
- Download any invoice as a boxed **PDF** or **Word (`.docx`)** document carrying the company logo and seal, issue credit notes against issued tax invoices, and record partial or full customer payments including **TDS deducted** by the customer.

### Step 13: Automated Payment Reminders and Job Closure
- Automatically build the email reminder schedule for unpaid tax invoices (before due date, on due date, and at configurable overdue intervals) addressed to customer contacts marked to receive invoices, with a per-invoice toggle to pause reminders.
- Automatically move a job to **Closed** as soon as every report on the job has been marked sent and every non-cancelled tax invoice on the job is fully settled (via payments, TDS, or credit notes), alongside a manual **Close job / Reopen job** button for management.

### Step 14: CA GST Export, Management Finance Reports, Settings, and Executive Telegram Bot
- **CA GST Files:** Download monthly or custom-date-range **GSTR-1** files (B2B by GSTIN, B2C, Credit Notes, and TDS summary) as CSV or multi-sheet Excel workbooks ready for the chartered accountant.
- **Management Finance Reports:** View and export CSVs for receivables ageing (`Not due`, `0–30`, `31–60`, `61–90`, `90+` days net of payments, TDS, and credit notes), customer-wise financial-year revenue and outstanding balance, monthly billed income vs. log-book site expenses, monthly payments received with TDS totals, and open proforma invoices not yet converted.
- **Settings & Recycle Bin:** Configure company profile and bank details, logo and seal uploads, invoice numbering counters, reminder timings, company holidays, dropdown option lists, test methods, report templates, role permissions, and restore any deleted record from the **Recycle bin**.
- **Telegram Executive Assistant:** Link management phones in Settings to query live business numbers (`/status`, `/jobs`, `/invoices`, `/overdue`, `/reports`, `/equipment`, `/schedule`, or natural-language questions) and receive instant alerts when reports are submitted, invoices are issued, or payments are recorded.

---

## New Since the 7 Nov Workflow Map

1. **Management Finance Page:** Dedicated financial reports screen with receivables ageing buckets, customer-wise financial-year revenue and outstanding balances, monthly billed income vs. log-book expenses, monthly payments with TDS totals, and unconverted proforma tracking—each with one-click CSV download.
2. **Jobs Register Export:** One-click CSV and Excel workbook export on the Jobs screen matching the physical inspection register columns, filterable by financial year, month, and customer.
3. **Automatic and Manual Job Closure:** Jobs now close automatically the moment all linked reports are marked sent and all non-cancelled tax invoices reach zero balance (after payments, TDS, and credit notes), plus management can manually close or reopen any job with full audit logging.
4. **Delete and Recycle Bin Everywhere:** Soft delete with confirmation prompts and role-permission checks across enquiries, quotations, jobs, customers, employees, equipment, log-book entries, price-list items, calendar assignments, and dropdown options—all restorable from the Recycle Bin.
5. **Real Company Logo, Seal, and Digital Signatures:** Upload the official company logo, company seal, and employee digital signatures in Settings and Employee profiles so approved reports and invoices carry authentic branding in print, PDF, and Word downloads.
6. **Email Paste-Assist on New Enquiry:** Paste a client's email text into the New Enquiry screen to extract and prefill the customer match, requirement, standard, component, quantity, site, and test methods before saving.
7. **Complete Application API for Every Action:** Every module—customers, enquiries, quotations, jobs, calendar, equipment, employees, log book, price list, reports (including PDF/Word downloads, approval, and return), invoices, finance reports, recycle bin, and settings—is now available through a unified, role-protected API for automations.

---

## Not Included / Decided Against (per 6 Nov Review Meeting)

- **WhatsApp Business Integration:** Decided against in the 6 Nov meeting because BITA does not use a dedicated WhatsApp Business API number and chose email reminders plus in-app technician notifications instead.
- **Zoho Books Integration:** Decided against in the 6 Nov meeting because BITA chose to generate proforma invoices, GST tax invoices, credit notes, and chartered-accountant GSTR-1 exports directly inside this system without paying for or maintaining a separate accounting sync.
- **Technician Web Browser Logins:** Decided against in the 6 Nov meeting because field technicians use the dedicated Android phone app paired via a 6-digit code rather than logging into the office web dashboard.
