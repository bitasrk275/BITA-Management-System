-- Idempotent demo seed for bita-dev (T13).
-- Fake data only (AGENTS.md hard rule 2): Test Turbines, Sample Forgings, Demo Gears, etc.
-- Never touches auth.users or existing people rows for logged-in users.
-- Safe to run multiple times (fixed UUIDs + ON CONFLICT DO NOTHING).

-- ---------------------------------------------------------------------------
-- 1. People (4 demo staff/technicians; 2 technicians without logins)
-- ---------------------------------------------------------------------------
insert into public.people (id, full_name, initials, position, mobile, email, roles, active)
values
  ('71000000-0000-0000-0000-000000000001', 'Demo Director (Management & Reviewer)', 'DDM', 'Technical Director', '+91 90000 00001', 'demo.director@example.test', '{management,reviewer}', true),
  ('71000000-0000-0000-0000-000000000002', 'Demo Coordinator (Office)', 'DCO', 'Operations Coordinator', '+91 90000 00002', 'demo.office@example.test', '{office}', true),
  ('71000000-0000-0000-0000-000000000003', 'Ramesh Sample (Technician)', 'RST', 'Senior NDT Technician', '+91 90000 00003', 'ramesh.tech@example.test', '{technician}', true),
  ('71000000-0000-0000-0000-000000000004', 'Kiran Mock (Technician)', 'KMT', 'NDT Technician', '+91 90000 00004', 'kiran.tech@example.test', '{technician}', true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Qualifications (including active Level II/III and one expired certificate)
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
  -- Expired UT qualification for Kiran Mock (triggers R20 expired warning)
  ('71100000-0000-0000-0000-000000000008', '71000000-0000-0000-0000-000000000004', 'UT', 'Level II', 'ASNT SNT-TC-1A', 'BITA', 'DEMO-SNT-UT-EXP', current_date - 1900, current_date - 45)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Equipment (4 UT flaw detectors and 2 MPI yokes; one due soon, one overdue)
-- ---------------------------------------------------------------------------
insert into public.equipment (id, kind, make, model, serial_no, calibrated_on, calibration_due, notes, active)
values
  ('72000000-0000-0000-0000-000000000001', 'ut_flaw_detector', 'Olympus', 'EPOCH 650', 'DEMO-UT-650-01', current_date - 180, current_date + 185, 'Primary field UT set', true),
  ('72000000-0000-0000-0000-000000000002', 'ut_flaw_detector', 'Krautkramer', 'USM 36', 'DEMO-UT-36-02', current_date - 350, current_date + 14, 'Calibration due within 30 days', true),
  ('72000000-0000-0000-0000-000000000003', 'ut_flaw_detector', 'Modsonic', 'Einstein II', 'DEMO-UT-EIN-03', current_date - 120, current_date + 245, 'Shop floor UT unit', true),
  ('72000000-0000-0000-0000-000000000004', 'ut_flaw_detector', 'Sonatest', 'Masterscan D-70', 'DEMO-UT-D70-04', current_date - 380, current_date - 15, 'Calibration overdue – send to lab', true),
  ('72000000-0000-0000-0000-000000000005', 'mpi_yoke', 'Magnaflux', 'Y-7 AC/DC', 'DEMO-YOKE-Y7-01', current_date - 90, current_date + 275, 'AC/DC electromagnetic yoke', true),
  ('72000000-0000-0000-0000-000000000006', 'mpi_yoke', 'Electromag', 'EM-220', 'DEMO-YOKE-EM-02', current_date - 345, current_date + 20, 'Due for lifting weight check soon', true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Customers (9 fake industrial customers; one uses_proforma = true) & Contacts
-- ---------------------------------------------------------------------------
insert into public.customers (id, name, code, gstin, billing_address, uses_proforma, payment_terms_days, mailbox, zoho_contact_id, notes)
values
  ('73000000-0000-0000-0000-000000000001', 'Test Turbines India Ltd', 'TTIL', '29AAACT0001A1Z5', 'Plot 14, Demo Industrial Area, Dabaspet, Bangalore 562111', true, 30, 'primary', 'DEMO-ZOHO-CUST-01', 'Proforma invoice required first; issues PO against proforma.'),
  ('73000000-0000-0000-0000-000000000002', 'Sample Forgings Pvt Ltd', 'SFPL', '29AAACS0002B1Z5', 'B-22, Peenya 2nd Stage, Bangalore 560058', false, 30, 'primary', 'DEMO-ZOHO-CUST-02', 'Regular UT and MPT on forged blanks and shafts.'),
  ('73000000-0000-0000-0000-000000000003', 'Demo Gears & Pinions Co', 'DGPC', '29AAACD0003C1Z5', 'Shed 8, Rajajinagar Industrial Town, Bangalore 560010', false, 30, 'primary', 'DEMO-ZOHO-CUST-03', 'Gear blank UT and tooth root MPT.'),
  ('73000000-0000-0000-0000-000000000004', 'Mock Valves & Castings Ltd', 'MVCL', '29AAACM0004D1Z5', 'Plot 41, Bommasandra Industrial Area, Bangalore 560099', false, 45, 'secondary', 'DEMO-ZOHO-CUST-04', 'DPT and UT on stainless steel valve bodies.'),
  ('73000000-0000-0000-0000-000000000005', 'Example Boilers & Vessels Pvt Ltd', 'EBVP', '29AAACE0005E1Z5', '12th Main, Jigani Industrial Area, Bangalore 560105', false, 30, 'primary', 'DEMO-ZOHO-CUST-05', 'Weld seam UT, MPT and RLA studies.'),
  ('73000000-0000-0000-0000-000000000006', 'Placeholder Heavy Engineering Ltd', 'PHEL', '29AAACP0006F1Z5', 'Phase 3, Peenya Industrial Area, Bangalore 560058', false, 30, 'secondary', 'DEMO-ZOHO-CUST-06', 'Heavy structural fabrication NDT.'),
  ('73000000-0000-0000-0000-000000000007', 'Sandbox Cranes & Hoists Pvt Ltd', 'SCHP', '29AAACS0007G1Z5', 'Whitefield Road, Mahadevapura, Bangalore 560048', false, 15, 'primary', 'DEMO-ZOHO-CUST-07', 'Crane hook MPT and load pin UT.'),
  ('73000000-0000-0000-0000-000000000008', 'Synthetic Shafts & Axles Ltd', 'SSAL', '29AAACS0008H1Z5', 'Plot 9, Doddaballapur Industrial Area, Bangalore 561203', false, 30, 'primary', 'DEMO-ZOHO-CUST-08', 'Stepped shaft ultrasonic inspection.'),
  ('73000000-0000-0000-0000-000000000009', 'Fictional Hydraulics & Cylinders Co', 'FHCC', '29AAACF0009J1Z5', 'Mysore Road Satellite Town, Bangalore 560026', false, 30, 'secondary', 'DEMO-ZOHO-CUST-09', 'Cylinder barrel weld UT and DPT.')
on conflict do nothing;

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
-- 5. Enquiries across all statuses (new, linked, quoted, converted, closed)
-- ---------------------------------------------------------------------------
insert into public.enquiries (id, source, external_id, mailbox, received_at, from_name, from_address, subject, body, extracted, customer_id, status)
values
  ('74000000-0000-0000-0000-000000000001', 'email', 'DEMO-ENQ-001', 'primary', now() - interval '3 hours', 'Suresh QA', 'qa@test-turbines.example.test', 'Urgent UT & MPT on 4 rotor shafts at Dabaspet', 'Please depute team tomorrow for UT and MPT on 4 rotor shafts (Dia 280 mm x 1800 mm).', '{"component": "Rotor shafts", "methods": ["UT", "MPT"], "quantity": 4}', '73000000-0000-0000-0000-000000000001', 'new'),
  ('74000000-0000-0000-0000-000000000002', 'whatsapp', 'DEMO-ENQ-002', 'primary', now() - interval '1 day', 'Prakash Forge', '+91 90000 00103', 'UT of 12 forged ring blanks at Peenya', 'Need quotation and visit for 12 forged alloy steel rings OD 650 mm.', '{"component": "Forged ring blanks", "methods": ["UT"], "quantity": 12}', '73000000-0000-0000-0000-000000000002', 'linked'),
  ('74000000-0000-0000-0000-000000000003', 'email', 'DEMO-ENQ-003', 'primary', now() - interval '3 days', 'Anil Purchase', 'purchase@demo-gears.example.test', 'Quotation for MPT of 25 carburised pinion shafts', 'Kindly send your lowest rate for wet fluorescent MPT of 25 pinion shafts.', '{"component": "Pinion shafts", "methods": ["MPT"], "quantity": 25}', '73000000-0000-0000-0000-000000000003', 'quoted'),
  ('74000000-0000-0000-0000-000000000004', 'phone', 'DEMO-ENQ-004', 'secondary', now() - interval '6 days', 'Deepa Inspection', '+91 90000 00105', 'DPT & UT on 8 CF8M gate valve bodies', 'PO issued; please schedule inspection at Bommasandra plant.', '{"component": "CF8M gate valve bodies", "methods": ["DPT", "UT"], "quantity": 8}', '73000000-0000-0000-0000-000000000004', 'converted'),
  ('74000000-0000-0000-0000-000000000005', 'email', 'DEMO-ENQ-005', 'secondary', now() - interval '12 days', 'Harish Fab', 'fab@placeholder-heavy.example.test', 'Budgetary quote for site RT & UT', 'Enquiry closed as project was postponed by end client.', '{"component": "Box girders", "methods": ["UT"]}', '73000000-0000-0000-0000-000000000006', 'closed')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Quotations (draft, approved, accepted) & Priced Items (R8–R13)
-- ---------------------------------------------------------------------------
insert into public.quotations (id, ref_no, customer_id, enquiry_id, quote_date, attention, subject, terms, status, approved_by, approved_at)
values
  ('75000000-0000-0000-0000-000000000001', 'DEMO-024-2026', '73000000-0000-0000-0000-000000000002', '74000000-0000-0000-0000-000000000002', current_date - 1, 'Mr. Prakash Forge, Plant Head', 'Ultrasonic Testing of Forged Ring Blanks', 'Payment within 30 days from invoice date; GST at 18% as applicable.', 'draft', null, null),
  ('75000000-0000-0000-0000-000000000002', 'DEMO-025-2026', '73000000-0000-0000-0000-000000000003', '74000000-0000-0000-0000-000000000003', current_date - 3, 'Mr. Anil Purchase, Purchase Dept', 'Magnetic Particle Testing of Carburised Pinion Shafts', 'Payment within 30 days from invoice date; GST at 18% as applicable.', 'approved', '71000000-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('75000000-0000-0000-0000-000000000003', 'DEMO-021-2026', '73000000-0000-0000-0000-000000000001', null, current_date - 20, 'Mr. Suresh QA, Quality Dept', 'Annual Standing Quotation for Turbine Rotor Shaft UT & MPT', 'Payment within 30 days from invoice date; GST at 18% as applicable.', 'accepted', '71000000-0000-0000-0000-000000000001', now() - interval '19 days'),
  ('75000000-0000-0000-0000-000000000004', 'DEMO-022-2026', '73000000-0000-0000-0000-000000000004', '74000000-0000-0000-0000-000000000004', current_date - 10, 'Ms. Deepa Inspection, QA Lead', 'DPT and UT on Stainless Steel Gate Valve Castings', 'Payment within 45 days from invoice date; GST at 18% as applicable.', 'accepted', '71000000-0000-0000-0000-000000000001', now() - interval '9 days')
on conflict do nothing;

insert into public.quotation_items (id, quotation_id, position, description, basis, rate, minimum_charge, notes)
values
  ('75100000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001', 1, 'Ultrasonic testing of alloy steel forged ring blanks (OD 650 mm)', 'per ring', 850.00, 5500.00, 'Includes local conveyance within Peenya'),
  ('75100000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000002', 1, 'Wet fluorescent MPT of carburised pinion shafts', 'per shaft', 320.00, 5000.00, 'Dark room facility to be provided at site'),
  ('75100000-0000-0000-0000-000000000003', '75000000-0000-0000-0000-000000000003', 1, 'Ultrasonic testing (Normal & Angle beam) of turbine rotor shaft', 'per shaft', 3200.00, 6500.00, 'Standing rate for FY 26-27'),
  ('75100000-0000-0000-0000-000000000004', '75000000-0000-0000-0000-000000000003', 2, 'Magnetic particle testing of rotor journal fillets', 'per shaft', 1400.00, null, 'When combined with UT visit'),
  ('75100000-0000-0000-0000-000000000005', '75000000-0000-0000-0000-000000000004', 1, 'Dye penetrant testing of machined CF8M valve body bores', 'per valve', 650.00, 4500.00, 'Solvent removable visible DPT'),
  ('75100000-0000-0000-0000-000000000006', '75000000-0000-0000-0000-000000000004', 2, 'Ultrasonic thickness and flange weld check on valve bodies', 'per valve', 900.00, null, null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Jobs (~10 jobs across every job_status)
-- ---------------------------------------------------------------------------
insert into public.jobs (id, job_no, customer_id, enquiry_id, quotation_id, po_number, po_date, site, scope, test_methods, status, closed_at)
values
  -- 1. enquiry_received (unassigned)
  ('76000000-0000-0000-0000-000000000001', 'BITA/26-27/9001', '73000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000003', null, null, 'Dabaspet Unit II', 'UT & MPT on 4 turbine rotor shafts (Lot #TR-44)', '{UT,MPT}', 'enquiry_received', null),
  -- 2. awaiting_approval
  ('76000000-0000-0000-0000-000000000002', 'BITA/26-27/9002', '73000000-0000-0000-0000-000000000002', '74000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000001', null, null, 'Peenya 2nd Stage', 'UT of 12 alloy steel forged ring blanks', '{UT}', 'awaiting_approval', null),
  -- 3. scheduled (assigned today)
  ('76000000-0000-0000-0000-000000000003', 'BITA/26-27/9003', '73000000-0000-0000-0000-000000000003', '74000000-0000-0000-0000-000000000003', '75000000-0000-0000-0000-000000000002', 'DGPC/PO/26-27/118', current_date - 1, 'Rajajinagar Works', 'MPT of 25 carburised pinion shafts', '{MPT}', 'scheduled', null),
  -- 4. scheduled (assigned later this week)
  ('76000000-0000-0000-0000-000000000004', 'BITA/26-27/9004', '73000000-0000-0000-0000-000000000007', null, null, 'SCHP/WO/884', current_date, 'Mahadevapura Bay 3', 'MPT of 50T EOT crane hook and load pin UT', '{UT,MPT}', 'scheduled', null),
  -- 5. inspection_done (has inspection with missing_fields)
  ('76000000-0000-0000-0000-000000000005', 'BITA/26-27/9005', '73000000-0000-0000-0000-000000000004', '74000000-0000-0000-0000-000000000004', '75000000-0000-0000-0000-000000000004', 'MVCL/PO/409', current_date - 4, 'Bommasandra Plant', 'DPT & UT on 8 CF8M gate valve bodies', '{DPT,UT}', 'inspection_done', null),
  -- 6. report_in_review (has draft & in_review reports)
  ('76000000-0000-0000-0000-000000000006', 'BITA/26-27/9006', '73000000-0000-0000-0000-000000000005', null, null, 'EBVP/PO/771', current_date - 6, 'Jigani Shop 1', 'Boiler steam drum circumferential weld seam UT', '{UT}', 'report_in_review', null),
  -- 7. report_sent (approved report sent; proforma issued for TTIL)
  ('76000000-0000-0000-0000-000000000007', 'BITA/26-27/9007', '73000000-0000-0000-0000-000000000001', null, '75000000-0000-0000-0000-000000000003', null, null, 'Dabaspet Unit I', 'UT of 2 generator exciter shafts (Batch #EX-19)', '{UT}', 'report_sent', null),
  -- 8. invoiced (invoice not yet due)
  ('76000000-0000-0000-0000-000000000008', 'BITA/26-27/9008', '73000000-0000-0000-0000-000000000008', null, null, 'SSAL/PO/2026/310', current_date - 10, 'Doddaballapur Plant', 'UT of 6 forged stepped drive axles', '{UT}', 'invoiced', null),
  -- 9. invoiced (invoice due this week)
  ('76000000-0000-0000-0000-000000000009', 'BITA/26-27/9009', '73000000-0000-0000-0000-000000000009', null, null, 'FHCC/PO/512', current_date - 26, 'Mysore Road Works', 'DPT of hydraulic cylinder end-cap welds', '{DPT}', 'invoiced', null),
  -- 10. invoiced (invoice overdue)
  ('76000000-0000-0000-0000-000000000010', 'BITA/26-27/9010', '73000000-0000-0000-0000-000000000002', null, null, 'SFPL/PO/198', current_date - 48, 'Peenya 2nd Stage', 'UT & MPT of 10 heavy crusher shafts', '{UT,MPT}', 'invoiced', null),
  -- 11. closed
  ('76000000-0000-0000-0000-000000000011', 'BITA/26-27/9011', '73000000-0000-0000-0000-000000000006', null, null, 'PHEL/PO/088', current_date - 60, 'Peenya Phase 3', 'UT of gantry girder butt welds', '{UT}', 'closed', now() - interval '15 days')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. Assignments & Assignment Equipment (today, this week, completed)
-- ---------------------------------------------------------------------------
insert into public.assignments (id, job_id, person_id, work_date, notes, notified_at, acknowledged_at, completed_at)
values
  -- Today: Ramesh on Job 9003 (acknowledged, in progress)
  ('77000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000003', current_date, 'Report to Mr. Anil at Gate 2 by 9:30 AM.', now() - interval '2 hours', now() - interval '1 hour', null),
  -- Today: Kiran on Job 9005 (completed with missing field in DPT)
  ('77000000-0000-0000-0000-000000000002', '76000000-0000-0000-0000-000000000005', '71000000-0000-0000-0000-000000000004', current_date, 'Check all 8 CF8M valve bodies in machine shop.', now() - interval '5 hours', now() - interval '4 hours', now() - interval '1 hour'),
  -- Later this week: Ramesh on Job 9004
  ('77000000-0000-0000-0000-000000000003', '76000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000003', current_date + 2, 'Bring both UT set and AC yoke for 50T crane hook.', now() - interval '1 hour', null, null),
  -- Past completed: Ramesh on Job 9006 & 9007
  ('77000000-0000-0000-0000-000000000004', '76000000-0000-0000-0000-000000000006', '71000000-0000-0000-0000-000000000003', current_date - 2, 'Steam drum seam W-1 to W-4.', now() - interval '3 days', now() - interval '2 days', now() - interval '2 days'),
  ('77000000-0000-0000-0000-000000000005', '76000000-0000-0000-0000-000000000007', '71000000-0000-0000-0000-000000000003', current_date - 5, 'Exciter shaft forging inspection.', now() - interval '6 days', now() - interval '5 days', now() - interval '5 days')
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
-- 9. Inspections (one with missing_fields, plus complete ones for reports)
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
-- 10. Reports (draft, in_review, approved)
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
-- 11. In-App Invoices (D-017: 1 draft, 2 issued, 1 partly_paid, 1 paid) + Lines & Payments
-- ---------------------------------------------------------------------------
-- Step 11a: Insert as draft first so invoice_lines can be added before issuing.
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
  -- 4. Issued overdue tax invoice (Job 9010, Sample Forgings Pvt Ltd)
  (
    '7a000000-0000-0000-0000-000000000004',
    '76000000-0000-0000-0000-000000000010',
    'tax_invoice',
    null,
    null,
    'BITA/26-27/INV-0903',
    'BITA/26-27/INV-0903',
    '29-Karnataka',
    current_date - 45,
    current_date - 15,
    36000.00, 3240.00, 3240.00, 0.00, 0.00, 42480.00, 42480.00,
    'draft',
    'SFPL/PO/198',
    false,
    'UT & MPT of 10 heavy crusher shafts at Peenya 2nd Stage.'
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

-- Step 11b: Insert invoice_lines while target invoices are in draft state (idempotent on re-run).
insert into public.invoice_lines (id, invoice_id, position, description, sac, qty, unit, rate, amount)
select v.id, v.invoice_id, v.position, v.description, v.sac, v.qty, v.unit, v.rate, v.amount
from (
  values
    ('7a100000-0000-0000-0000-000000000001'::uuid, '7a000000-0000-0000-0000-000000000001'::uuid, 1, 'Ultrasonic testing (Normal & Angle beam) of 2 generator exciter shafts (minimum charge applied)', '998346', 1.000, 'visit', 6500.00, 6500.00),
    ('7a100000-0000-0000-0000-000000000002'::uuid, '7a000000-0000-0000-0000-000000000002'::uuid, 1, 'Ultrasonic testing of forged stepped drive axles', '998346', 6.000, 'nos', 2000.00, 12000.00),
    ('7a100000-0000-0000-0000-000000000003'::uuid, '7a000000-0000-0000-0000-000000000002'::uuid, 2, 'Site mobilization & calibration block charges (Doddaballapur)', '998346', 1.000, 'visit', 4000.00, 4000.00),
    ('7a100000-0000-0000-0000-000000000004'::uuid, '7a000000-0000-0000-0000-000000000003'::uuid, 1, 'Dye penetrant testing of hydraulic cylinder end-cap welds', '998346', 15.000, 'joints', 800.00, 12000.00),
    ('7a100000-0000-0000-0000-000000000005'::uuid, '7a000000-0000-0000-0000-000000000004'::uuid, 1, 'Ultrasonic & magnetic particle testing of heavy crusher shafts', '998346', 10.000, 'shafts', 3600.00, 36000.00),
    ('7a100000-0000-0000-0000-000000000006'::uuid, '7a000000-0000-0000-0000-000000000005'::uuid, 1, 'Ultrasonic flaw detection of gantry girder butt welds', '998346', 25.000, 'metres', 800.00, 20000.00)
) as v(id, invoice_id, position, description, sac, qty, unit, rate, amount)
where not exists (select 1 from public.invoice_lines l where l.id = v.id)
  and exists (select 1 from public.invoices i where i.id = v.invoice_id and i.status = 'draft');

-- Step 11c: Issue invoices 2, 3, 4, and 5 (leaves invoice 1 as draft).
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

-- Step 11d: Record partial payment on invoice 3 (-> partly_paid) and full payments on invoice 5 (-> paid).
insert into public.payments (id, invoice_id, amount, paid_on, mode, reference)
select v.id, v.invoice_id, v.amount, v.paid_on, v.mode, v.reference
from (
  values
    ('7a200000-0000-0000-0000-000000000001'::uuid, '7a000000-0000-0000-0000-000000000003'::uuid, 8000.00, current_date - 10, 'NEFT', 'DEMO-UTR-FHCC-8001'),
    ('7a200000-0000-0000-0000-000000000002'::uuid, '7a000000-0000-0000-0000-000000000005'::uuid, 10000.00, current_date - 40, 'NEFT', 'DEMO-UTR-PHEL-4001'),
    ('7a200000-0000-0000-0000-000000000003'::uuid, '7a000000-0000-0000-0000-000000000005'::uuid, 13600.00, current_date - 28, 'RTGS', 'DEMO-UTR-PHEL-4002')
) as v(id, invoice_id, amount, paid_on, mode, reference)
where not exists (select 1 from public.payments p where p.id = v.id);

-- ---------------------------------------------------------------------------
-- 12. Technician leave / delay messages today (X1)
-- ---------------------------------------------------------------------------
insert into public.technician_messages (id, external_id, person_id, job_id, assignment_id, kind, body, received_at)
values
  ('7b000000-0000-0000-0000-000000000001', 'DEMO-MSG-LEAVE-001', '71000000-0000-0000-0000-000000000004', null, null, 'leave', 'Requesting half-day leave this afternoon after completing Bommasandra valve DPT.', now() - interval '30 minutes')
on conflict do nothing;
