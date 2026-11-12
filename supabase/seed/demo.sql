-- Idempotent Phase 2 UAT & demo seed (T13 / G12).
-- Fake data only (AGENTS.md hard rule 2): Test Turbines, Sample Forgings, Demo Gears, etc.
-- NEVER run on bita-dev or production: the first statement below refuses to execute if
-- public.customers already contains any row not marked as fake.
-- Never touches auth.users or existing people rows for logged-in users.
-- Safe to run multiple times (fixed UUIDs + ON CONFLICT DO NOTHING / DO UPDATE).

-- ---------------------------------------------------------------------------
-- 0. Safety guard: refuse to run if public.customers has non-fake rows
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.customers c
    where coalesce(c.notes, '') not ilike '%[FAKE%'
      and coalesce(c.zoho_contact_id, '') not like 'DEMO-%'
      and not exists (
        select 1
        from public.customer_contacts cc
        where cc.customer_id = c.id
          and cc.email like '%.example.test'
      )
  ) then
    raise exception 'Refusing to run demo.sql: public.customers contains non-fake customer records (never run demo.sql on production or bita-dev).';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Phase 2 Settings: fake company_profile, invoice_numbering starting at 1, holidays
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, description)
values
  (
    'company_profile',
    '{
      "name": "DEMO INSPECTION & TESTING AGENCY (UAT SANDBOX)",
      "address": "Plot 99, Fake Industrial Estate, Peenya Test Zone, Bengaluru 560058",
      "phone": "+91 80 0000 0000",
      "email": "uat-office@example.test",
      "pan": "AAACD0000F",
      "gstin": "29AAACD0000F1Z5",
      "default_sac": "998393",
      "bank_name": "Sandbox State Bank (FAKE UAT)",
      "bank_branch": "Peenya Test Branch",
      "bank_account_no": "0000001234567890",
      "bank_ifsc": "SBIN0000000"
    }'::jsonb,
    'Fake UAT company header, tax identifiers, default SAC 998393, and sandbox bank account details'
  ),
  (
    'invoice_numbering',
    '{
      "tax_prefix": "INV-",
      "next_tax_no": 1,
      "next_tax_invoice_no": 1,
      "proforma_prefix": "PI-",
      "next_proforma_no": 1,
      "credit_note_prefix": "CN-",
      "next_credit_note_no": 1,
      "default_sac": "998393"
    }'::jsonb,
    'UAT invoice, proforma, and credit note numbering counters starting at 1'
  ),
  (
    'holidays',
    '{
      "dates": [
        "2026-01-26",
        "2026-05-01",
        "2026-08-15",
        "2026-10-02",
        "2026-11-01"
      ]
    }'::jsonb,
    'UAT holiday dates (YYYY-MM-DD); Sundays are always off'
  )
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. People (4 demo staff/technicians; 2 technicians without logins + monthly_salary)
-- ---------------------------------------------------------------------------
insert into public.people (id, full_name, initials, position, mobile, email, roles, monthly_salary, active)
values
  ('71000000-0000-0000-0000-000000000001', 'Demo Director (Management & Reviewer)', 'DDM', 'Technical Director', '+91 90000 00001', 'demo.director@example.test', '{management,reviewer}', 95000.00, true),
  ('71000000-0000-0000-0000-000000000002', 'Demo Coordinator (Office)', 'DCO', 'Operations Coordinator', '+91 90000 00002', 'demo.office@example.test', '{office}', 42000.00, true),
  ('71000000-0000-0000-0000-000000000003', 'Ramesh Sample (Technician)', 'RST', 'Senior NDT Technician', '+91 90000 00003', 'ramesh.tech@example.test', '{technician}', 38000.00, true),
  ('71000000-0000-0000-0000-000000000004', 'Kiran Mock (Technician)', 'KMT', 'NDT Technician', '+91 90000 00004', 'kiran.tech@example.test', '{technician}', 32000.00, true)
on conflict (id) do update
  set monthly_salary = excluded.monthly_salary;

-- ---------------------------------------------------------------------------
-- 3. Qualifications (including active Level II/III and one expired certificate)
-- ---------------------------------------------------------------------------
insert into public.qualifications (id, person_id, method, level, scheme, certifying_body, certificate_no, issued_on, valid_until)
values
  ('71100000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'UT', 'Level III', 'ASNT SNT-TC-1A', 'ASNT', 'DEMO-ASNT-UT-301', current_date - 730, current_date + 1095),
  ('71100000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', 'MPT', 'Level III', 'ISNT', 'ISNT', 'DEMO-ISNT-MT-302', current_date - 730, current_date + 1095),
  ('71100000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000003', 'UT', 'Level II', 'ISNT', 'ISNT', 'DEMO-ISNT-UT-201', current_date - 400, current_date + 695),
  ('71100000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000003', 'MPT', 'Level II', 'ASNT SNT-TC-1A', 'BITA', 'DEMO-SNT-MT-202', current_date - 350, current_date + 745),
  ('71100000-0000-0000-0000-000000000005', '71000000-0000-0000-0000-000000000003', 'DPT', 'Level II', 'ASNT SNT-TC-1A', 'BITA', 'DEMO-SNT-PT-203', current_date - 350, current_date + 745),
  ('71100000-0000-0000-0000-000000000006', '71000000-0000-0000-0000-000000000004', 'MPT', 'Level II', 'ISNT', 'ISNT', 'DEMO-ISNT-MT-211', current_date - 300, current_date + 795),
  ('71100000-0000-0000-0000-000000000007', '71000000-0000-0000-0000-000000000004', 'DPT', 'Level II', 'ISNT', 'ISNT', 'DEMO-ISNT-PT-212', current_date - 300, current_date + 795),
  -- Expired UT qualification for Kiran Mock (triggers qualification expiry warning)
  ('71100000-0000-0000-0000-000000000008', '71000000-0000-0000-0000-000000000004', 'UT', 'Level II', 'ASNT SNT-TC-1A', 'BITA', 'DEMO-SNT-UT-EXP', current_date - 1900, current_date - 45)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Equipment (4 UT flaw detectors and 2 MPI yokes; one due soon, one expired calibration)
-- ---------------------------------------------------------------------------
insert into public.equipment (id, kind, make, model, serial_no, calibrated_on, calibration_due, status, current_location, notes, active)
values
  ('72000000-0000-0000-0000-000000000001', 'ut_flaw_detector', 'Olympus', 'EPOCH 650', 'DEMO-UT-650-01', current_date - 180, current_date + 185, 'in_office', 'In office', 'Primary field UT set', true),
  ('72000000-0000-0000-0000-000000000002', 'ut_flaw_detector', 'Krautkramer', 'USM 36', 'DEMO-UT-36-02', current_date - 350, current_date + 14, 'in_office', 'In office', 'Calibration due within 30 days', true),
  ('72000000-0000-0000-0000-000000000003', 'ut_flaw_detector', 'Modsonic', 'Einstein II', 'DEMO-UT-EIN-03', current_date - 120, current_date + 245, 'in_office', 'In office', 'Shop floor UT unit', true),
  ('72000000-0000-0000-0000-000000000004', 'ut_flaw_detector', 'Sonatest', 'Masterscan D-70', 'DEMO-UT-D70-04', current_date - 380, current_date - 15, 'out_for_calibration', 'Calibration Lab (Fake)', 'Calibration overdue – send to lab', true),
  ('72000000-0000-0000-0000-000000000005', 'mpi_yoke', 'Magnaflux', 'Y-7 AC/DC', 'DEMO-YOKE-Y7-01', current_date - 90, current_date + 275, 'at_site', 'Rajajinagar Works', 'AC/DC electromagnetic yoke', true),
  ('72000000-0000-0000-0000-000000000006', 'mpi_yoke', 'Electromag', 'EM-220', 'DEMO-YOKE-EM-02', current_date - 345, current_date + 20, 'in_office', 'In office', 'Due for lifting weight check soon', true)
on conflict do nothing;

update public.equipment e
set equipment_type_id = et.id
from public.equipment_types et
where e.equipment_type_id is null
  and (
    (e.kind = 'ut_flaw_detector' and et.name = 'UT flaw detector')
    or (e.kind = 'mpi_yoke' and et.name = 'MT yoke')
  );

-- ---------------------------------------------------------------------------
-- 5. Phase 2 Price List (public.price_items)
-- ---------------------------------------------------------------------------
insert into public.price_items (id, name, description, sac, unit, default_rate, active)
values
  ('72500000-0000-0000-0000-000000000001', 'Ultrasonic Testing (UT) – Forgings & Shafts', 'Normal and angle beam ultrasonic flaw detection per ASTM A388 / ASME Sec V', '998393', 'nos', 3200.00, true),
  ('72500000-0000-0000-0000-000000000002', 'Magnetic Particle Testing (MPT) – Wet Fluorescent', 'Fluorescent magnetic particle inspection of machined shafts and gears', '998393', 'nos', 850.00, true),
  ('72500000-0000-0000-0000-000000000003', 'Dye Penetrant Testing (DPT) – Valve & Weld Surfaces', 'Liquid penetrant inspection per ASME Sec V Art 6', '998393', 'nos', 650.00, true),
  ('72500000-0000-0000-0000-000000000004', 'Ultrasonic Weld Seam Inspection (Butt Welds)', '100% angle beam scanning of pressure vessel and girder butt welds', '998393', 'metres', 800.00, true),
  ('72500000-0000-0000-0000-000000000005', 'Minimum Site Visit & Mobilization Charge', 'Minimum inspection team deputation charge within industrial area', '998393', 'visit', 6500.00, true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Customers (fake industrial customers across Karnataka 29, Tamil Nadu 33,
--    and Maharashtra 27 so both CGST/SGST and IGST appear) & Contacts
-- ---------------------------------------------------------------------------
insert into public.customers (id, name, code, gstin, billing_address, uses_proforma, payment_terms_days, mailbox, zoho_contact_id, notes)
values
  ('73000000-0000-0000-0000-000000000001', 'Test Turbines India Ltd', 'TTIL', '29AAACT0001A1Z5', 'Plot 14, Demo Industrial Area, Dabaspet, Bangalore 562111, Karnataka', true, 30, 'primary', 'DEMO-ZOHO-CUST-01', '[FAKE-UAT] Proforma invoice required first; issues PO against proforma (Karnataka CGST+SGST).'),
  ('73000000-0000-0000-0000-000000000002', 'Sample Forgings Pvt Ltd', 'SFPL', '33AAACS0002B1Z5', 'Plot B-22, SIPCOT Phase II, Hosur 635109, Tamil Nadu', false, 30, 'primary', 'DEMO-ZOHO-CUST-02', '[FAKE-UAT] Inter-state customer in Tamil Nadu (IGST 18%); regular UT and MPT on forged blanks.'),
  ('73000000-0000-0000-0000-000000000003', 'Demo Gears & Pinions Co', 'DGPC', '27AAACD0003C1Z5', 'Shed 8, MIDC Bhosari, Pune 411026, Maharashtra', false, 30, 'primary', 'DEMO-ZOHO-CUST-03', '[FAKE-UAT] Inter-state customer in Maharashtra (IGST 18%); gear blank UT and tooth root MPT.'),
  ('73000000-0000-0000-0000-000000000004', 'Mock Valves & Castings Ltd', 'MVCL', '29AAACM0004D1Z5', 'Plot 41, Bommasandra Industrial Area, Bangalore 560099, Karnataka', false, 45, 'secondary', 'DEMO-ZOHO-CUST-04', '[FAKE-UAT] DPT and UT on stainless steel valve bodies.'),
  ('73000000-0000-0000-0000-000000000005', 'Example Boilers & Vessels Pvt Ltd', 'EBVP', '29AAACE0005E1Z5', '12th Main, Jigani Industrial Area, Bangalore 560105, Karnataka', false, 30, 'primary', 'DEMO-ZOHO-CUST-05', '[FAKE-UAT] Weld seam UT, MPT and RLA studies.'),
  ('73000000-0000-0000-0000-000000000006', 'Placeholder Heavy Engineering Ltd', 'PHEL', '29AAACP0006F1Z5', 'Phase 3, Peenya Industrial Area, Bangalore 560058, Karnataka', false, 30, 'secondary', 'DEMO-ZOHO-CUST-06', '[FAKE-UAT] Heavy structural fabrication NDT.'),
  ('73000000-0000-0000-0000-000000000007', 'Sandbox Cranes & Hoists Pvt Ltd', 'SCHP', '29AAACS0007G1Z5', 'Whitefield Road, Mahadevapura, Bangalore 560048, Karnataka', false, 15, 'primary', 'DEMO-ZOHO-CUST-07', '[FAKE-UAT] Crane hook MPT and load pin UT.'),
  ('73000000-0000-0000-0000-000000000008', 'Synthetic Shafts & Axles Ltd', 'SSAL', '29AAACS0008H1Z5', 'Plot 9, Doddaballapur Industrial Area, Bangalore 561203, Karnataka', false, 30, 'primary', 'DEMO-ZOHO-CUST-08', '[FAKE-UAT] Stepped shaft ultrasonic inspection.'),
  ('73000000-0000-0000-0000-000000000009', 'Fictional Hydraulics & Cylinders Co', 'FHCC', '29AAACF0009J1Z5', 'Mysore Road Satellite Town, Bangalore 560026, Karnataka', false, 30, 'secondary', 'DEMO-ZOHO-CUST-09', '[FAKE-UAT] Cylinder barrel weld UT and DPT.')
on conflict (id) do update
  set gstin = excluded.gstin,
      billing_address = excluded.billing_address,
      notes = excluded.notes;

insert into public.customer_contacts (id, customer_id, name, mobile, email, receives_reports, receives_invoices, notes)
values
  ('73100000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', 'Suresh QA (Test Turbines)', '+91 90000 00101', 'qa@test-turbines.example.test', true, false, 'Quality Manager'),
  ('73100000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000001', 'Meera Accounts (Test Turbines)', '+91 90000 00102', 'accounts@test-turbines.example.test', false, true, 'Accounts Payable – proforma & PO'),
  ('73100000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000002', 'Prakash Forge (Sample Forgings)', '+91 90000 00103', 'qc@sample-forgings.example.test', true, true, 'Plant Head'),
  ('73100000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000003', 'Anil Purchase (Demo Gears)', '+91 90000 00104', 'purchase@demo-gears.example.test', true, true, 'Purchase & QC'),
  ('73100000-0000-0000-0000-000000000005', '73000000-0000-0000-0000-000000000004', 'Deepa Inspection (Mock Valves)', '+91 90000 00105', 'qa@mock-valves.example.test', true, true, 'Valve QA Lead'),
  ('73100000-0000-0000-0000-000000000006', '73000000-0000-0000-0000-000000000005', 'Vikram Projects (Example Boilers)', '+91 90000 00106', 'projects@example-boilers.example.test', true, true, 'Project Engineer'),
  ('73100000-0000-0000-0000-000000000007', '73000000-0000-0000-0000-000000000006', 'Harish Fab (Placeholder Heavy)', '+91 90000 00107', 'fab@placeholder-heavy.example.test', true, true, 'Fabrication Manager'),
  ('73100000-0000-0000-0000-000000000008', '73000000-0000-0000-0000-000000000007', 'Naveen Safety (Sandbox Cranes)', '+91 90000 00108', 'safety@sandbox-cranes.example.test', true, true, 'Maintenance Head'),
  ('73100000-0000-0000-0000-000000000009', '73000000-0000-0000-0000-000000000008', 'Rohit Axle (Synthetic Shafts)', '+91 90000 00109', 'qc@synthetic-shafts.example.test', true, true, 'Metallurgy & NDT'),
  ('73100000-0000-0000-0000-000000000010', '73000000-0000-0000-0000-000000000009', 'Kavitha Hyd (Fictional Hydraulics)', '+91 90000 00110', 'info@fictional-hydraulics.example.test', true, true, 'Operations')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Enquiries across all statuses (new, linked, quoted, converted, closed)
-- ---------------------------------------------------------------------------
insert into public.enquiries (id, source, external_id, mailbox, received_at, from_name, from_address, subject, body, extracted, customer_id, status)
values
  ('74000000-0000-0000-0000-000000000001', 'email', 'DEMO-ENQ-001', 'primary', now() - interval '3 hours', 'Suresh QA', 'qa@test-turbines.example.test', 'Urgent UT & MPT on 4 rotor shafts at Dabaspet', 'Please depute team tomorrow for UT and MPT on 4 rotor shafts (Dia 280 mm x 1800 mm).', '{"component": "Rotor shafts", "methods": ["UT", "MPT"], "quantity": 4}', '73000000-0000-0000-0000-000000000001', 'new'),
  ('74000000-0000-0000-0000-000000000002', 'whatsapp', 'DEMO-ENQ-002', 'primary', now() - interval '1 day', 'Prakash Forge', '+91 90000 00103', 'UT of 12 forged ring blanks at Hosur', 'Need quotation and visit for 12 forged alloy steel rings OD 650 mm.', '{"component": "Forged ring blanks", "methods": ["UT"], "quantity": 12}', '73000000-0000-0000-0000-000000000002', 'linked'),
  ('74000000-0000-0000-0000-000000000003', 'email', 'DEMO-ENQ-003', 'primary', now() - interval '3 days', 'Anil Purchase', 'purchase@demo-gears.example.test', 'Quotation for MPT of 25 carburised pinion shafts', 'Kindly send your lowest rate for wet fluorescent MPT of 25 pinion shafts.', '{"component": "Pinion shafts", "methods": ["MPT"], "quantity": 25}', '73000000-0000-0000-0000-000000000003', 'quoted'),
  ('74000000-0000-0000-0000-000000000004', 'phone', 'DEMO-ENQ-004', 'secondary', now() - interval '6 days', 'Deepa Inspection', '+91 90000 00105', 'DPT & UT on 8 CF8M gate valve bodies', 'PO issued; please schedule inspection at Bommasandra plant.', '{"component": "CF8M gate valve bodies", "methods": ["DPT", "UT"], "quantity": 8}', '73000000-0000-0000-0000-000000000004', 'converted'),
  ('74000000-0000-0000-0000-000000000005', 'email', 'DEMO-ENQ-005', 'secondary', now() - interval '12 days', 'Harish Fab', 'fab@placeholder-heavy.example.test', 'Budgetary quote for site RT & UT', 'Enquiry closed as project was postponed by end client.', '{"component": "Box girders", "methods": ["UT"]}', '73000000-0000-0000-0000-000000000006', 'closed')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. Quotations (including uploaded quotation file in storage.objects) & Priced Items
-- ---------------------------------------------------------------------------
insert into storage.objects (id, bucket_id, name)
values
  ('75900000-0000-0000-0000-000000000001', 'documents', 'quotations/75000000-0000-0000-0000-000000000003/DEMO-021-2026.pdf')
on conflict do nothing;

insert into public.quotations (id, ref_no, customer_id, enquiry_id, quote_date, attention, subject, terms, pdf_path, status, approved_by, approved_at)
values
  ('75000000-0000-0000-0000-000000000001', 'DEMO-024-2026', '73000000-0000-0000-0000-000000000002', '74000000-0000-0000-0000-000000000002', current_date - 1, 'Mr. Prakash Forge, Plant Head', 'Ultrasonic Testing of Forged Ring Blanks', 'Payment within 30 days from invoice date; GST at 18% as applicable.', null, 'draft', null, null),
  ('75000000-0000-0000-0000-000000000002', 'DEMO-025-2026', '73000000-0000-0000-0000-000000000003', '74000000-0000-0000-0000-000000000003', current_date - 3, 'Mr. Anil Purchase, Purchase Dept', 'Magnetic Particle Testing of Carburised Pinion Shafts', 'Payment within 30 days from invoice date; GST at 18% as applicable.', null, 'approved', '71000000-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('75000000-0000-0000-0000-000000000003', 'DEMO-021-2026', '73000000-0000-0000-0000-000000000001', null, current_date - 20, 'Mr. Suresh QA, Quality Dept', 'Annual Standing Quotation for Turbine Rotor Shaft UT & MPT', 'Payment within 30 days from invoice date; GST at 18% as applicable.', 'quotations/75000000-0000-0000-0000-000000000003/DEMO-021-2026.pdf', 'accepted', '71000000-0000-0000-0000-000000000001', now() - interval '19 days'),
  ('75000000-0000-0000-0000-000000000004', 'DEMO-022-2026', '73000000-0000-0000-0000-000000000004', '74000000-0000-0000-0000-000000000004', current_date - 10, 'Ms. Deepa Inspection, QA Lead', 'DPT and UT on Stainless Steel Gate Valve Castings', 'Payment within 45 days from invoice date; GST at 18% as applicable.', null, 'accepted', '71000000-0000-0000-0000-000000000001', now() - interval '9 days')
on conflict (id) do update
  set pdf_path = coalesce(public.quotations.pdf_path, excluded.pdf_path);

insert into public.quotation_items (id, quotation_id, position, description, basis, rate, minimum_charge, notes)
values
  ('75100000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001', 1, 'Ultrasonic testing of alloy steel forged ring blanks (OD 650 mm)', 'per ring', 850.00, 5500.00, 'Includes local conveyance'),
  ('75100000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000002', 1, 'Wet fluorescent MPT of carburised pinion shafts', 'per shaft', 320.00, 5000.00, 'Dark room facility to be provided at site'),
  ('75100000-0000-0000-0000-000000000003', '75000000-0000-0000-0000-000000000003', 1, 'Ultrasonic testing (Normal & Angle beam) of turbine rotor shaft', 'per shaft', 3200.00, 6500.00, 'Standing rate for FY 26-27'),
  ('75100000-0000-0000-0000-000000000004', '75000000-0000-0000-0000-000000000003', 2, 'Magnetic particle testing of rotor journal fillets', 'per shaft', 1400.00, null, 'When combined with UT visit'),
  ('75100000-0000-0000-0000-000000000005', '75000000-0000-0000-0000-000000000004', 1, 'Dye penetrant testing of machined CF8M valve body bores', 'per valve', 650.00, 4500.00, 'Solvent removable visible DPT'),
  ('75100000-0000-0000-0000-000000000006', '75000000-0000-0000-0000-000000000004', 2, 'Ultrasonic thickness and flange weld check on valve bodies', 'per valve', 900.00, null, null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 9. Jobs (~11 jobs across every job_status, including po_value)
-- ---------------------------------------------------------------------------
insert into public.jobs (id, job_no, customer_id, enquiry_id, quotation_id, po_number, po_date, po_value, site, scope, test_methods, status, closed_at)
values
  -- 1. enquiry_received (unassigned)
  ('76000000-0000-0000-0000-000000000001', 'BITA/26-27/9001', '73000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000003', null, null, null, 'Dabaspet Unit II', 'UT & MPT on 4 turbine rotor shafts (Lot #TR-44)', '{UT,MPT}', 'enquiry_received', null),
  -- 2. awaiting_approval
  ('76000000-0000-0000-0000-000000000002', 'BITA/26-27/9002', '73000000-0000-0000-0000-000000000002', '74000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000001', null, null, null, 'Hosur SIPCOT Phase II', 'UT of 12 alloy steel forged ring blanks', '{UT}', 'awaiting_approval', null),
  -- 3. scheduled (accepted job scheduled on the calendar today)
  ('76000000-0000-0000-0000-000000000003', 'BITA/26-27/9003', '73000000-0000-0000-0000-000000000003', '74000000-0000-0000-0000-000000000003', '75000000-0000-0000-0000-000000000002', 'DGPC/PO/26-27/118', current_date - 1, 25000.00, 'Pune MIDC Works', 'MPT of 25 carburised pinion shafts', '{MPT}', 'scheduled', null),
  -- 4. scheduled (assigned later this week)
  ('76000000-0000-0000-0000-000000000004', 'BITA/26-27/9004', '73000000-0000-0000-0000-000000000007', null, null, 'SCHP/WO/884', current_date, 18000.00, 'Mahadevapura Bay 3', 'MPT of 50T EOT crane hook and load pin UT', '{UT,MPT}', 'scheduled', null),
  -- 5. inspection_done (has inspection with missing_fields)
  ('76000000-0000-0000-0000-000000000005', 'BITA/26-27/9005', '73000000-0000-0000-0000-000000000004', '74000000-0000-0000-0000-000000000004', '75000000-0000-0000-0000-000000000004', 'MVCL/PO/409', current_date - 4, 15000.00, 'Bommasandra Plant', 'DPT & UT on 8 CF8M gate valve bodies', '{DPT,UT}', 'inspection_done', null),
  -- 6. report_in_review (has draft & in_review reports)
  ('76000000-0000-0000-0000-000000000006', 'BITA/26-27/9006', '73000000-0000-0000-0000-000000000005', null, null, 'EBVP/PO/771', current_date - 6, 30000.00, 'Jigani Shop 1', 'Boiler steam drum circumferential weld seam UT', '{UT}', 'report_in_review', null),
  -- 7. report_sent (approved report sent; ready for proforma/tax invoice)
  ('76000000-0000-0000-0000-000000000007', 'BITA/26-27/9007', '73000000-0000-0000-0000-000000000001', null, '75000000-0000-0000-0000-000000000003', 'TTIL/PO/26-27/501', current_date - 5, 50000.00, 'Dabaspet Unit I', 'UT of 2 generator exciter shafts (Batch #EX-19)', '{UT}', 'report_sent', null),
  -- 8. invoiced (invoice not yet due)
  ('76000000-0000-0000-0000-000000000008', 'BITA/26-27/9008', '73000000-0000-0000-0000-000000000008', null, null, 'SSAL/PO/2026/310', current_date - 10, 20000.00, 'Doddaballapur Plant', 'UT of 6 forged stepped drive axles', '{UT}', 'invoiced', null),
  -- 9. invoiced (invoice due this week)
  ('76000000-0000-0000-0000-000000000009', 'BITA/26-27/9009', '73000000-0000-0000-0000-000000000009', null, null, 'FHCC/PO/512', current_date - 26, 15000.00, 'Mysore Road Works', 'DPT of hydraulic cylinder end-cap welds', '{DPT}', 'invoiced', null),
  -- 10. invoiced (invoice overdue – Tamil Nadu IGST customer)
  ('76000000-0000-0000-0000-000000000010', 'BITA/26-27/9010', '73000000-0000-0000-0000-000000000002', null, null, 'SFPL/PO/198', current_date - 48, 45000.00, 'Hosur SIPCOT Phase II', 'UT & MPT of 10 heavy crusher shafts', '{UT,MPT}', 'invoiced', null),
  -- 11. closed
  ('76000000-0000-0000-0000-000000000011', 'BITA/26-27/9011', '73000000-0000-0000-0000-000000000006', null, null, 'PHEL/PO/088', current_date - 60, 25000.00, 'Peenya Phase 3', 'UT of gantry girder butt welds', '{UT}', 'closed', now() - interval '15 days')
on conflict (id) do update
  set po_value = coalesce(public.jobs.po_value, excluded.po_value);

-- ---------------------------------------------------------------------------
-- 10. Assignments (scheduled on Calendar with end_date) & Assignment Equipment
-- ---------------------------------------------------------------------------
insert into public.assignments (id, job_id, person_id, work_date, end_date, notes, notified_at, acknowledged_at, completed_at)
values
  -- Today: Ramesh on Job 9003 (scheduled on calendar)
  ('77000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000003', current_date, current_date + 1, 'Report to Mr. Anil at Gate 2 by 9:30 AM.', now() - interval '2 hours', now() - interval '1 hour', null),
  -- Today: Kiran on Job 9005 (completed with missing field in DPT)
  ('77000000-0000-0000-0000-000000000002', '76000000-0000-0000-0000-000000000005', '71000000-0000-0000-0000-000000000004', current_date, current_date, 'Check all 8 CF8M valve bodies in machine shop.', now() - interval '5 hours', now() - interval '4 hours', now() - interval '1 hour'),
  -- Later this week: Ramesh on Job 9004
  ('77000000-0000-0000-0000-000000000003', '76000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000003', current_date + 2, current_date + 2, 'Bring both UT set and AC yoke for 50T crane hook.', now() - interval '1 hour', null, null),
  -- Past completed: Ramesh on Job 9006 & 9007
  ('77000000-0000-0000-0000-000000000004', '76000000-0000-0000-0000-000000000006', '71000000-0000-0000-0000-000000000003', current_date - 2, current_date - 2, 'Steam drum seam W-1 to W-4.', now() - interval '3 days', now() - interval '2 days', now() - interval '2 days'),
  ('77000000-0000-0000-0000-000000000005', '76000000-0000-0000-0000-000000000007', '71000000-0000-0000-0000-000000000003', current_date - 5, current_date - 5, 'Exciter shaft forging inspection.', now() - interval '6 days', now() - interval '5 days', now() - interval '5 days')
on conflict do nothing;

insert into public.assignment_equipment (assignment_id, equipment_id)
values
  ('77000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000005'),
  ('77000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000002'),
  ('77000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000001'),
  ('77000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000006'),
  ('77000000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-000000000001'),
  ('77000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 11. Inspections (one with missing_fields, plus complete ones for reports)
-- ---------------------------------------------------------------------------
insert into public.inspections (id, job_id, assignment_id, method, readings, observations, submitted_by, submitted_at, missing_fields)
values
  -- Incomplete DPT inspection on Job 9005 (missing cleaner_batch & developing_time)
  (
    '78000000-0000-0000-0000-000000000001',
    '76000000-0000-0000-0000-000000000005',
    '77000000-0000-0000-0000-000000000002',
    'DPT',
    '{"client":"Mock Valves & Castings Ltd","project":"DPT & UT on 8 CF8M gate valve bodies","inspection_site":"Bommasandra Plant","inspection_date":"2026-11-06","component_description":"CF8M 150# Gate Valve Body","cleaner":"Magnaflux SKC-S","cleaner_batch":"","penetrant":"Magnaflux SKL-SP2","penetrant_batch":"B-2604","developer":"Magnaflux SKD-S2","developer_batch":"B-2609","standard":"ASME Sec V Art 6","dwell_time":"15 minutes","developing_time":"","technicians":[{"name":"Kiran Mock (Technician)","qualification":"ISNT Level II","certificate_no":"DEMO-ISNT-PT-212","issued_on":"2026-01-10","valid_until":"2029-01-09"}],"items":[{"description":"CF8M Gate Valve Body Bore & Seat Area","quantity":8,"observations":"No linear or rounded indications observed."}]}'::jsonb,
    'Cleaner batch number on tin was smudged; confirming from store.',
    '71000000-0000-0000-0000-000000000004',
    now() - interval '1 hour',
    '{cleaner_batch,developing_time}'
  ),
  -- Complete UT inspection on Job 9006 (for in_review report)
  (
    '78000000-0000-0000-0000-000000000002',
    '76000000-0000-0000-0000-000000000006',
    '77000000-0000-0000-0000-000000000004',
    'UT',
    '{"client":"Example Boilers & Vessels Pvt Ltd","project":"Boiler steam drum circumferential weld seam UT","inspection_site":"Jigani Shop 1","inspection_date":"2026-11-04","equipment":"Olympus EPOCH 650","equipment_serial":"DEMO-UT-650-01","probes":"4 MHz Normal & 45/60 deg MWB","reference_blocks":"IIW V1 & V2","screen_range":"0 - 200 mm","sensitivity":"DAC + 6 dB","scanning_level":"Reference + 6 dB","couplant":"Cellulose paste","surface_condition":"As welded, dressed smooth","standard":"ASME Sec V Art 4","acceptance_criteria":"ASME Sec I PW-52","technicians":[{"name":"Ramesh Sample (Technician)","qualification":"ISNT Level II","certificate_no":"DEMO-ISNT-UT-201","issued_on":"2025-10-01","valid_until":"2028-09-30"}],"items":[{"description":"Steam Drum Circumferential Weld Seams CS-01 to CS-04 (Thk 36 mm)","quantity":4,"observations":"No recordable planar or volumetric indications observed. Acceptable per ASME Sec I."}]}'::jsonb,
    'All four circumferential weld seams scanned 100% from both sides.',
    '71000000-0000-0000-0000-000000000003',
    now() - interval '2 days',
    '{}'
  ),
  -- Complete UT inspection on Job 9007 (for approved report)
  (
    '78000000-0000-0000-0000-000000000003',
    '76000000-0000-0000-0000-000000000007',
    '77000000-0000-0000-0000-000000000005',
    'UT',
    '{"client":"Test Turbines India Ltd","project":"UT of 2 generator exciter shafts (Batch #EX-19)","inspection_site":"Dabaspet Unit I","inspection_date":"2026-11-01","equipment":"Olympus EPOCH 650","equipment_serial":"DEMO-UT-650-01","probes":"2.25 MHz & 4 MHz Normal","reference_blocks":"IIW V1","screen_range":"0 - 500 mm","sensitivity":"2 mm FBH","scanning_level":"Reference + 6 dB","couplant":"Machine oil","surface_condition":"Rough turned (Ra < 6.3 um)","standard":"ASTM A388","acceptance_criteria":"EN 10228-3 Class 3","technicians":[{"name":"Ramesh Sample (Technician)","qualification":"ISNT Level II","certificate_no":"DEMO-ISNT-UT-201","issued_on":"2025-10-01","valid_until":"2028-09-30"}],"items":[{"description":"Forged Alloy Steel Exciter Shafts Heat #H-8812 & #H-8813","quantity":2,"observations":"100% radial and axial scan completed; no back-wall loss or indications exceeding 2 mm EFBH."}]}'::jsonb,
    'Satisfactory.',
    '71000000-0000-0000-0000-000000000003',
    now() - interval '5 days',
    '{}'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 12. Reports (draft, in_review, approved)
-- ---------------------------------------------------------------------------
insert into public.reports (id, job_id, inspection_id, method, report_no, report_date, content, status, prepared_by, reviewed_by, approved_by, approved_at, signatory_id, sent_at, sent_to)
values
  -- Draft report on Job 9006
  (
    '79000000-0000-0000-0000-000000000001',
    '76000000-0000-0000-0000-000000000006',
    '78000000-0000-0000-0000-000000000002',
    'UT',
    'DEMO-BITA/UT/26-27/0901',
    current_date - 1,
    '{"summary":"Draft UT report for steam drum weld seams"}'::jsonb,
    'draft',
    '71000000-0000-0000-0000-000000000002',
    null,
    null,
    null,
    '71000000-0000-0000-0000-000000000001',
    null,
    '{}'
  ),
  -- In-review report on Job 9006
  (
    '79000000-0000-0000-0000-000000000002',
    '76000000-0000-0000-0000-000000000006',
    '78000000-0000-0000-0000-000000000002',
    'UT',
    'DEMO-BITA/UT/26-27/0902',
    current_date - 1,
    '{"summary":"UT report awaiting technical reviewer approval"}'::jsonb,
    'in_review',
    '71000000-0000-0000-0000-000000000002',
    null,
    null,
    null,
    '71000000-0000-0000-0000-000000000001',
    null,
    '{}'
  ),
  -- Approved & sent report on Job 9007
  (
    '79000000-0000-0000-0000-000000000003',
    '76000000-0000-0000-0000-000000000007',
    '78000000-0000-0000-0000-000000000003',
    'UT',
    'DEMO-BITA/UT/26-27/0895',
    current_date - 4,
    '{"summary":"Approved UT report for 2 exciter shafts"}'::jsonb,
    'approved',
    '71000000-0000-0000-0000-000000000002',
    '71000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000001',
    now() - interval '4 days',
    '71000000-0000-0000-0000-000000000001',
    now() - interval '4 days',
    '{qa@test-turbines.example.test}'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 13. In-App Invoices (D-017: 1 draft, 2 issued, 1 partly_paid, 1 paid) + Lines & Payments
-- ---------------------------------------------------------------------------
-- Step 13a: Insert as draft first so invoice_lines can be added before issuing.
insert into public.invoices (
  id, job_id, kind, report_id, quotation_id, invoice_no, number,
  place_of_supply, invoice_date, due_date,
  taxable_value, cgst, sgst, igst, round_off, total, balance,
  status, customer_po_number, reminders_paused, notes
)
values
  -- 1. Draft tax invoice for Test Turbines India Ltd (Job 9007, linked to approved report & accepted quotation)
  (
    '7a000000-0000-0000-0000-000000000001',
    '76000000-0000-0000-0000-000000000007',
    'tax_invoice',
    '79000000-0000-0000-0000-000000000003',
    '75000000-0000-0000-0000-000000000003',
    null,
    null,
    '29-Karnataka',
    current_date,
    current_date + 30,
    6500.00, 585.00, 585.00, 0.00, 0.00, 7670.00, 7670.00,
    'draft',
    null,
    false,
    'Draft invoice generated from approved UT report DEMO-BITA/UT/26-27/0895 (minimum visit charge applied).'
  ),
  -- 2. Issued tax invoice not yet due (Job 9008, Synthetic Shafts & Axles Ltd)
  (
    '7a000000-0000-0000-0000-000000000002',
    '76000000-0000-0000-0000-000000000008',
    'tax_invoice',
    null,
    null,
    'BITA/26-27/INV-0901',
    'BITA/26-27/INV-0901',
    '29-Karnataka',
    current_date - 8,
    current_date + 22,
    16000.00, 1440.00, 1440.00, 0.00, 0.00, 18880.00, 18880.00,
    'draft',
    'SSAL/PO/2026/310',
    false,
    'UT of 6 forged stepped drive axles at Doddaballapur Plant.'
  ),
  -- 3. Partly paid tax invoice due this week (Job 9009, Fictional Hydraulics & Cylinders Co)
  (
    '7a000000-0000-0000-0000-000000000003',
    '76000000-0000-0000-0000-000000000009',
    'tax_invoice',
    null,
    null,
    'BITA/26-27/INV-0902',
    'BITA/26-27/INV-0902',
    '29-Karnataka',
    current_date - 26,
    current_date + 4,
    12000.00, 1080.00, 1080.00, 0.00, 0.00, 14160.00, 14160.00,
    'draft',
    'FHCC/PO/512',
    false,
    'DPT of hydraulic cylinder end-cap welds at Mysore Road Works.'
  ),
  -- 4. Issued overdue IGST tax invoice (Job 9010, Sample Forgings Pvt Ltd in Tamil Nadu 33)
  (
    '7a000000-0000-0000-0000-000000000004',
    '76000000-0000-0000-0000-000000000010',
    'tax_invoice',
    null,
    null,
    'BITA/26-27/INV-0903',
    'BITA/26-27/INV-0903',
    '33-Tamil Nadu',
    current_date - 45,
    current_date - 15,
    36000.00, 0.00, 0.00, 6480.00, 0.00, 42480.00, 42480.00,
    'draft',
    'SFPL/PO/198',
    false,
    'Inter-state IGST invoice: UT & MPT of 10 heavy crusher shafts at Hosur.'
  ),
  -- 5. Paid tax invoice on closed Job 9011 (Placeholder Heavy Engineering Ltd)
  (
    '7a000000-0000-0000-0000-000000000005',
    '76000000-0000-0000-0000-000000000011',
    'tax_invoice',
    null,
    null,
    'BITA/26-27/INV-0904',
    'BITA/26-27/INV-0904',
    '29-Karnataka',
    current_date - 55,
    current_date - 25,
    20000.00, 1800.00, 1800.00, 0.00, 0.00, 23600.00, 23600.00,
    'draft',
    'PHEL/PO/088',
    false,
    'UT of gantry girder butt welds at Peenya Phase 3.'
  )
on conflict do nothing;

-- Step 13b: Insert invoice_lines while target invoices are in draft state (idempotent on re-run).
insert into public.invoice_lines (id, invoice_id, position, description, sac, qty, unit, rate, amount)
select v.id, v.invoice_id, v.position, v.description, v.sac, v.qty, v.unit, v.rate, v.amount
from (
  values
    ('7a100000-0000-0000-0000-000000000001'::uuid, '7a000000-0000-0000-0000-000000000001'::uuid, 1, 'Ultrasonic testing (Normal & Angle beam) of 2 generator exciter shafts (minimum charge applied)', '998393', 1.000, 'visit', 6500.00, 6500.00),
    ('7a100000-0000-0000-0000-000000000002'::uuid, '7a000000-0000-0000-0000-000000000002'::uuid, 1, 'Ultrasonic testing of forged stepped drive axles', '998393', 6.000, 'nos', 2000.00, 12000.00),
    ('7a100000-0000-0000-0000-000000000003'::uuid, '7a000000-0000-0000-0000-000000000002'::uuid, 2, 'Site mobilization & calibration block charges (Doddaballapur)', '998393', 1.000, 'visit', 4000.00, 4000.00),
    ('7a100000-0000-0000-0000-000000000004'::uuid, '7a000000-0000-0000-0000-000000000003'::uuid, 1, 'Dye penetrant testing of hydraulic cylinder end-cap welds', '998393', 15.000, 'joints', 800.00, 12000.00),
    ('7a100000-0000-0000-0000-000000000005'::uuid, '7a000000-0000-0000-0000-000000000004'::uuid, 1, 'Ultrasonic & magnetic particle testing of heavy crusher shafts', '998393', 10.000, 'shafts', 3600.00, 36000.00),
    ('7a100000-0000-0000-0000-000000000006'::uuid, '7a000000-0000-0000-0000-000000000005'::uuid, 1, 'Ultrasonic flaw detection of gantry girder butt welds', '998393', 25.000, 'metres', 800.00, 20000.00)
) as v(id, invoice_id, position, description, sac, qty, unit, rate, amount)
where not exists (select 1 from public.invoice_lines l where l.id = v.id)
  and exists (select 1 from public.invoices i where i.id = v.invoice_id and i.status = 'draft');

-- Step 13c: Issue invoices 2, 3, 4, and 5 (leaves invoice 1 as draft).
update public.invoices
set status = 'issued',
    issued_at = coalesce(issued_at, (invoice_date::timestamp at time zone 'Asia/Kolkata') + interval '10 hours')
where id in (
  '7a000000-0000-0000-0000-000000000002',
  '7a000000-0000-0000-0000-000000000003',
  '7a000000-0000-0000-0000-000000000004',
  '7a000000-0000-0000-0000-000000000005'
)
  and status = 'draft';

-- Step 13d: Record partial payment on invoice 3 (-> partly_paid) and full payments on invoice 5 (-> paid).
insert into public.payments (id, invoice_id, amount, paid_on, mode, reference)
select v.id, v.invoice_id, v.amount, v.paid_on, v.mode, v.reference
from (
  values
    ('7a200000-0000-0000-0000-000000000001'::uuid, '7a000000-0000-0000-0000-000000000003'::uuid, 8000.00, current_date - 10, 'NEFT', 'DEMO-UTR-FHCC-8001'),
    ('7a200000-0000-0000-0000-000000000002'::uuid, '7a000000-0000-0000-0000-000000000005'::uuid, 10000.00, current_date - 40, 'NEFT', 'DEMO-UTR-PHEL-4001'),
    ('7a200000-0000-0000-0000-000000000003'::uuid, '7a000000-0000-0000-0000-000000000005'::uuid, 13600.00, current_date - 28, 'RTGS', 'DEMO-UTR-PHEL-4002')
) as v(id, invoice_id, amount, paid_on, mode, reference)
where not exists (select 1 from public.payments p where p.id = v.id);

-- Step 13e: Reset invoice_numbering settings counter back to 1 so UAT users issue their own tax/proforma invoices starting at 1.
delete from public.invoice_counters;
update public.settings
set value = '{
  "tax_prefix": "INV-",
  "next_tax_no": 1,
  "next_tax_invoice_no": 1,
  "proforma_prefix": "PI-",
  "next_proforma_no": 1,
  "credit_note_prefix": "CN-",
  "next_credit_note_no": 1,
  "default_sac": "998393"
}'::jsonb
where key = 'invoice_numbering';

-- ---------------------------------------------------------------------------
-- 14. Technician leave / delay messages today (X1)
-- ---------------------------------------------------------------------------
insert into public.technician_messages (id, external_id, person_id, job_id, assignment_id, kind, body, received_at)
values
  ('7b000000-0000-0000-0000-000000000001', 'DEMO-MSG-LEAVE-001', '71000000-0000-0000-0000-000000000004', null, null, 'leave', 'Requesting half-day leave this afternoon after completing Bommasandra valve DPT.', now() - interval '30 minutes')
on conflict do nothing;
