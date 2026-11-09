-- Seed BITA UT Report Field dropdown options (1-29 from BITA UT Report Fields spec)
-- and default invoice_numbering (next_tax_no = 5388, default_sac = 998393) + reminder_timings.

insert into public.settings_options (list_key, value, position, active)
values
  ('ut_equipment', 'GE USM 36S', 10, true),
  ('ut_equipment', 'Olympus Epoch 650', 20, true),
  ('ut_equipment', 'Krautkramer USM 35X', 30, true),
  ('ut_equipment', 'Modsonic Einstein II', 40, true),
  ('ut_probe', 'Ø24x2MHz Normal Probe B2S', 10, true),
  ('ut_probe', 'Ø10x4MHz Normal Probe', 20, true),
  ('ut_probe', '45° 4MHz Angle Probe MWB45-4', 30, true),
  ('ut_probe', '60° 4MHz Angle Probe MWB60-4', 40, true),
  ('ut_probe', '70° 4MHz Angle Probe MWB70-4', 50, true),
  ('ut_probe', 'TR Probe SEB2', 60, true),
  ('reference_blocks', 'IIW/V2', 10, true),
  ('reference_blocks', 'IIW V1 & V2', 20, true),
  ('reference_blocks', 'V1', 30, true),
  ('reference_blocks', 'V2', 40, true),
  ('reference_blocks', 'Step wedge', 50, true),
  ('reference_blocks', 'IIW/V1 & DGS Block', 60, true),
  ('calibration_method', 'Ø 2mm DGS with BW', 10, true),
  ('calibration_method', 'Ø 3mm DGS with BW', 20, true),
  ('calibration_method', 'DAC', 30, true),
  ('calibration_method', 'DGS', 40, true),
  ('calibration_method', 'BW', 50, true),
  ('calibration_method', 'AWS', 60, true),
  ('couplant', 'Oil', 10, true),
  ('couplant', 'Grease', 20, true),
  ('couplant', 'Gel', 30, true),
  ('couplant', 'Water', 40, true),
  ('scanning_level', '+6 dB', 10, true),
  ('scanning_level', '+12 dB', 20, true),
  ('scanning_level', 'Reference level', 30, true),
  ('surface_condition', 'Proof Machined', 10, true),
  ('surface_condition', 'Machined', 20, true),
  ('surface_condition', 'Rough machined', 30, true),
  ('surface_condition', 'As forged', 40, true),
  ('surface_condition', 'As cast', 50, true),
  ('surface_condition', 'Ground', 60, true),
  ('ut_standard', 'ASTM A388', 10, true),
  ('ut_standard', 'EN 10228-3', 20, true),
  ('ut_standard', 'ASTM A609', 30, true),
  ('ut_standard', 'ASME Sec V Art. 4', 40, true),
  ('ut_standard', 'ASME Sec V Art. 5', 50, true),
  ('ut_standard', 'IS 3664', 60, true),
  ('ut_acceptance', 'Clause 2.1', 10, true),
  ('ut_acceptance', 'Class 1', 20, true),
  ('ut_acceptance', 'Class 2', 30, true),
  ('ut_acceptance', 'Class 3', 40, true),
  ('ut_acceptance', 'Level 1', 50, true),
  ('ut_acceptance', 'Level 2', 60, true),
  ('ut_acceptance', 'As per client specification', 70, true),
  ('component_description', 'Proof Machined Shaft Forging', 10, true),
  ('component_description', 'Shaft forging', 20, true),
  ('component_description', 'Rotor forging', 30, true),
  ('component_description', 'Casting', 40, true),
  ('component_description', 'Weld joint', 50, true),
  ('component_description', 'Plate', 60, true),
  ('qty_unit', 'No.', 10, true),
  ('qty_unit', 'Nos.', 20, true),
  ('qty_unit', 'Sets', 30, true),
  ('observation_sentences', 'Forging scanned with normal probe all round and no significant indications observed.', 10, true),
  ('observation_sentences', 'Forging scanned with normal probe all round and no significant indications observed. At one spot, recordable indication observed. Refer Annexure.', 20, true),
  ('observation_sentences', 'No recordable defect observed.', 30, true),
  ('observation_sentences', 'Scanned 100% and found satisfactory.', 40, true),
  ('report_result', 'Accepted', 10, true),
  ('report_result', 'Rejected', 20, true),
  ('report_result', 'Accepted with remarks', 30, true)
on conflict (list_key, value) do nothing;

insert into public.settings (key, value, description)
values
  (
    'invoice_numbering',
    '{"tax_prefix": "", "next_tax_no": 5388, "proforma_prefix": "PI/", "next_proforma_no": 1, "credit_note_prefix": "CN/", "next_credit_note_no": 1, "default_sac": "998393"}'::jsonb,
    'Invoice, proforma, and credit note numbering counters and prefixes'
  ),
  (
    'reminder_timings',
    '{"before_due_days": 2, "on_due": true, "overdue_start_days": 5, "calibration_alert_days": 30}'::jsonb,
    'Payment reminder schedule intervals and equipment calibration alert window'
  )
on conflict (key) do nothing;
