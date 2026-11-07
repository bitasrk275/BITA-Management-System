// Generated from the bita-dev Supabase project. Do not edit by hand; Naveen regenerates it after every migration.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      assignment_equipment: {
        Row: {
          assignment_id: string
          equipment_id: string
        }
        Insert: {
          assignment_id: string
          equipment_id: string
        }
        Update: {
          assignment_id?: string
          equipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_equipment_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_equipment_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          acknowledged_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          job_id: string
          notes: string | null
          notified_at: string | null
          person_id: string
          started_at: string | null
          work_date: string
        }
        Insert: {
          acknowledged_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          job_id: string
          notes?: string | null
          notified_at?: string | null
          person_id: string
          started_at?: string | null
          work_date: string
        }
        Update: {
          acknowledged_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          job_id?: string
          notes?: string | null
          notified_at?: string | null
          person_id?: string
          started_at?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          caption: string | null
          id: string
          include_in_report: boolean
          inspection_id: string | null
          job_id: string
          kind: string
          report_id: string | null
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          id?: string
          include_in_report?: boolean
          inspection_id?: string | null
          job_id: string
          kind: string
          report_id?: string | null
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          id?: string
          include_in_report?: boolean
          inspection_id?: string | null
          job_id?: string
          kind?: string
          report_id?: string | null
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by_person: string | null
          changed_by_user: string | null
          changed_fields: string[]
          id: number
          management_notified_at: string | null
          new_row: Json | null
          old_row: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by_person?: string | null
          changed_by_user?: string | null
          changed_fields?: string[]
          id?: never
          management_notified_at?: string | null
          new_row?: Json | null
          old_row?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by_person?: string | null
          changed_by_user?: string | null
          changed_fields?: string[]
          id?: never
          management_notified_at?: string | null
          new_row?: Json | null
          old_row?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      customer_contacts: {
        Row: {
          created_at: string
          customer_id: string
          email: string | null
          id: string
          mobile: string | null
          name: string
          notes: string | null
          receives_invoices: boolean
          receives_reports: boolean
        }
        Insert: {
          created_at?: string
          customer_id: string
          email?: string | null
          id?: string
          mobile?: string | null
          name: string
          notes?: string | null
          receives_invoices?: boolean
          receives_reports?: boolean
        }
        Update: {
          created_at?: string
          customer_id?: string
          email?: string | null
          id?: string
          mobile?: string | null
          name?: string
          notes?: string | null
          receives_invoices?: boolean
          receives_reports?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          billing_address: string | null
          code: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          gstin: string | null
          id: string
          mailbox: string | null
          name: string
          notes: string | null
          payment_terms_days: number
          uses_proforma: boolean
          zoho_contact_id: string | null
        }
        Insert: {
          billing_address?: string | null
          code?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          gstin?: string | null
          id?: string
          mailbox?: string | null
          name: string
          notes?: string | null
          payment_terms_days?: number
          uses_proforma?: boolean
          zoho_contact_id?: string | null
        }
        Update: {
          billing_address?: string | null
          code?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          gstin?: string | null
          id?: string
          mailbox?: string | null
          name?: string
          notes?: string | null
          payment_terms_days?: number
          uses_proforma?: boolean
          zoho_contact_id?: string | null
        }
        Relationships: []
      }
      enquiries: {
        Row: {
          body: string | null
          created_at: string
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          external_id: string | null
          extracted: Json
          from_address: string | null
          from_name: string | null
          id: string
          mailbox: string | null
          received_at: string
          source: Database["public"]["Enums"]["enquiry_source"]
          status: Database["public"]["Enums"]["enquiry_status"]
          subject: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          external_id?: string | null
          extracted?: Json
          from_address?: string | null
          from_name?: string | null
          id?: string
          mailbox?: string | null
          received_at?: string
          source: Database["public"]["Enums"]["enquiry_source"]
          status?: Database["public"]["Enums"]["enquiry_status"]
          subject?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          external_id?: string | null
          extracted?: Json
          from_address?: string | null
          from_name?: string | null
          id?: string
          mailbox?: string | null
          received_at?: string
          source?: Database["public"]["Enums"]["enquiry_source"]
          status?: Database["public"]["Enums"]["enquiry_status"]
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enquiries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          active: boolean
          calibrated_on: string | null
          calibration_due: string | null
          certificate_path: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          kind: Database["public"]["Enums"]["equipment_kind"]
          make: string | null
          model: string | null
          notes: string | null
          serial_no: string | null
        }
        Insert: {
          active?: boolean
          calibrated_on?: string | null
          calibration_due?: string | null
          certificate_path?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["equipment_kind"]
          make?: string | null
          model?: string | null
          notes?: string | null
          serial_no?: string | null
        }
        Update: {
          active?: boolean
          calibrated_on?: string | null
          calibration_due?: string | null
          certificate_path?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["equipment_kind"]
          make?: string | null
          model?: string | null
          notes?: string | null
          serial_no?: string | null
        }
        Relationships: []
      }
      inspection_edits: {
        Row: {
          assignment_id: string
          diff: Json
          edited_at: string
          edited_by: string
          id: string
          inspection_id: string | null
          job_id: string
          new_observations: string | null
          new_readings: Json
          old_observations: string | null
          old_readings: Json
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          assignment_id: string
          diff?: Json
          edited_at?: string
          edited_by: string
          id?: string
          inspection_id?: string | null
          job_id: string
          new_observations?: string | null
          new_readings?: Json
          old_observations?: string | null
          old_readings?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          assignment_id?: string
          diff?: Json
          edited_at?: string
          edited_by?: string
          id?: string
          inspection_id?: string | null
          job_id?: string
          new_observations?: string | null
          new_readings?: Json
          old_observations?: string | null
          old_readings?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_edits_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_edits_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_edits_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_edits_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_edits_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          assignment_id: string | null
          created_at: string
          id: string
          job_id: string
          method: Database["public"]["Enums"]["test_method"]
          missing_fields: string[]
          observations: string | null
          readings: Json
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string
          id?: string
          job_id: string
          method: Database["public"]["Enums"]["test_method"]
          missing_fields?: string[]
          observations?: string | null
          readings?: Json
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          assignment_id?: string | null
          created_at?: string
          id?: string
          job_id?: string
          method?: Database["public"]["Enums"]["test_method"]
          missing_fields?: string[]
          observations?: string | null
          readings?: Json
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          financial_year: string
          last_no: number
        }
        Insert: {
          financial_year: string
          last_no: number
        }
        Update: {
          financial_year?: string
          last_no?: number
        }
        Relationships: []
      }
      invoice_lines: {
        Row: {
          amount: number
          description: string
          id: string
          invoice_id: string
          position: number
          qty: number
          rate: number
          sac: string
          unit: string | null
        }
        Insert: {
          amount?: number
          description: string
          id?: string
          invoice_id: string
          position?: number
          qty?: number
          rate?: number
          sac?: string
          unit?: string | null
        }
        Update: {
          amount?: number
          description?: string
          id?: string
          invoice_id?: string
          position?: number
          qty?: number
          rate?: number
          sac?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          balance: number
          cgst: number
          created_at: string
          customer_po_number: string | null
          due_date: string | null
          id: string
          igst: number
          invoice_date: string | null
          invoice_no: string | null
          issued_at: string | null
          job_id: string
          kind: Database["public"]["Enums"]["invoice_kind"]
          last_synced_at: string | null
          notes: string | null
          number: string | null
          pdf_path: string | null
          place_of_supply: string | null
          quotation_id: string | null
          reminders_paused: boolean
          report_id: string | null
          round_off: number
          sgst: number
          status: string
          taxable_value: number
          total: number
          zoho_id: string | null
        }
        Insert: {
          balance?: number
          cgst?: number
          created_at?: string
          customer_po_number?: string | null
          due_date?: string | null
          id?: string
          igst?: number
          invoice_date?: string | null
          invoice_no?: string | null
          issued_at?: string | null
          job_id: string
          kind: Database["public"]["Enums"]["invoice_kind"]
          last_synced_at?: string | null
          notes?: string | null
          number?: string | null
          pdf_path?: string | null
          place_of_supply?: string | null
          quotation_id?: string | null
          reminders_paused?: boolean
          report_id?: string | null
          round_off?: number
          sgst?: number
          status?: string
          taxable_value?: number
          total?: number
          zoho_id?: string | null
        }
        Update: {
          balance?: number
          cgst?: number
          created_at?: string
          customer_po_number?: string | null
          due_date?: string | null
          id?: string
          igst?: number
          invoice_date?: string | null
          invoice_no?: string | null
          issued_at?: string | null
          job_id?: string
          kind?: Database["public"]["Enums"]["invoice_kind"]
          last_synced_at?: string | null
          notes?: string | null
          number?: string | null
          pdf_path?: string | null
          place_of_supply?: string | null
          quotation_id?: string | null
          reminders_paused?: boolean
          report_id?: string | null
          round_off?: number
          sgst?: number
          status?: string
          taxable_value?: number
          total?: number
          zoho_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      job_counters: {
        Row: {
          financial_year: string
          last_no: number
        }
        Insert: {
          financial_year: string
          last_no: number
        }
        Update: {
          financial_year?: string
          last_no?: number
        }
        Relationships: []
      }
      jobs: {
        Row: {
          closed_at: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          deleted_by: string | null
          enquiry_id: string | null
          id: string
          job_no: string
          po_date: string | null
          po_number: string | null
          po_path: string | null
          po_value: number | null
          quotation_id: string | null
          scope: string | null
          site: string | null
          status: Database["public"]["Enums"]["job_status"]
          test_methods: Database["public"]["Enums"]["test_method"][]
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          deleted_by?: string | null
          enquiry_id?: string | null
          id?: string
          job_no?: string
          po_date?: string | null
          po_number?: string | null
          po_path?: string | null
          po_value?: number | null
          quotation_id?: string | null
          scope?: string | null
          site?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          test_methods?: Database["public"]["Enums"]["test_method"][]
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          enquiry_id?: string | null
          id?: string
          job_no?: string
          po_date?: string | null
          po_number?: string | null
          po_path?: string | null
          po_value?: number | null
          quotation_id?: string | null
          scope?: string | null
          site?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          test_methods?: Database["public"]["Enums"]["test_method"][]
        }
        Relationships: [
          {
            foreignKeyName: "jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      pairing_codes: {
        Row: {
          code_hash: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          person_id: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          person_id: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          person_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pairing_codes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reminders: {
        Row: {
          from_mailbox: string | null
          id: string
          invoice_id: string
          kind: string
          scheduled_for: string
          sent_at: string | null
          sent_to: string[]
        }
        Insert: {
          from_mailbox?: string | null
          id?: string
          invoice_id: string
          kind: string
          scheduled_for: string
          sent_at?: string | null
          sent_to?: string[]
        }
        Update: {
          from_mailbox?: string | null
          id?: string
          invoice_id?: string
          kind?: string
          scheduled_for?: string
          sent_at?: string | null
          sent_to?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "payment_reminders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          mode: string | null
          paid_on: string
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          mode?: string | null
          paid_on?: string
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          mode?: string | null
          paid_on?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          active: boolean
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          full_name: string
          id: string
          initials: string | null
          mobile: string | null
          position: string | null
          roles: Database["public"]["Enums"]["app_role"][]
          signature_path: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          initials?: string | null
          mobile?: string | null
          position?: string | null
          roles?: Database["public"]["Enums"]["app_role"][]
          signature_path?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          initials?: string | null
          mobile?: string | null
          position?: string | null
          roles?: Database["public"]["Enums"]["app_role"][]
          signature_path?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      qualifications: {
        Row: {
          certificate_no: string | null
          certificate_path: string | null
          certifying_body: string | null
          created_at: string
          id: string
          issued_on: string | null
          level: string
          method: Database["public"]["Enums"]["test_method"]
          person_id: string
          scheme: string | null
          valid_until: string | null
        }
        Insert: {
          certificate_no?: string | null
          certificate_path?: string | null
          certifying_body?: string | null
          created_at?: string
          id?: string
          issued_on?: string | null
          level: string
          method: Database["public"]["Enums"]["test_method"]
          person_id: string
          scheme?: string | null
          valid_until?: string | null
        }
        Update: {
          certificate_no?: string | null
          certificate_path?: string | null
          certifying_body?: string | null
          created_at?: string
          id?: string
          issued_on?: string | null
          level?: string
          method?: Database["public"]["Enums"]["test_method"]
          person_id?: string
          scheme?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qualifications_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_items: {
        Row: {
          basis: string | null
          description: string
          id: string
          minimum_charge: number | null
          notes: string | null
          position: number
          quotation_id: string
          rate: number | null
        }
        Insert: {
          basis?: string | null
          description: string
          id?: string
          minimum_charge?: number | null
          notes?: string | null
          position?: number
          quotation_id: string
          rate?: number | null
        }
        Update: {
          basis?: string | null
          description?: string
          id?: string
          minimum_charge?: number | null
          notes?: string | null
          position?: number
          quotation_id?: string
          rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attention: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          deleted_by: string | null
          enquiry_id: string | null
          id: string
          pdf_path: string | null
          quote_date: string
          ref_no: string | null
          status: Database["public"]["Enums"]["quotation_status"]
          subject: string | null
          superseded_by: string | null
          terms: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attention?: string | null
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          deleted_by?: string | null
          enquiry_id?: string | null
          id?: string
          pdf_path?: string | null
          quote_date?: string
          ref_no?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          subject?: string | null
          superseded_by?: string | null
          terms?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attention?: string | null
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          enquiry_id?: string | null
          id?: string
          pdf_path?: string | null
          quote_date?: string
          ref_no?: string | null
          status?: Database["public"]["Enums"]["quotation_status"]
          subject?: string | null
          superseded_by?: string | null
          terms?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "enquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          content: Json
          created_at: string
          id: string
          inspection_id: string | null
          job_id: string
          method: Database["public"]["Enums"]["test_method"]
          pdf_path: string | null
          prepared_by: string | null
          report_date: string
          report_no: string
          reviewed_by: string | null
          sent_at: string | null
          sent_to: string[]
          signatory_id: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          content?: Json
          created_at?: string
          id?: string
          inspection_id?: string | null
          job_id: string
          method: Database["public"]["Enums"]["test_method"]
          pdf_path?: string | null
          prepared_by?: string | null
          report_date?: string
          report_no: string
          reviewed_by?: string | null
          sent_at?: string | null
          sent_to?: string[]
          signatory_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          content?: Json
          created_at?: string
          id?: string
          inspection_id?: string | null
          job_id?: string
          method?: Database["public"]["Enums"]["test_method"]
          pdf_path?: string | null
          prepared_by?: string | null
          report_date?: string
          report_no?: string
          reviewed_by?: string | null
          sent_at?: string | null
          sent_to?: string[]
          signatory_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reports_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_signatory_id_fkey"
            columns: ["signatory_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_options: {
        Row: {
          active: boolean
          created_at: string
          id: string
          list_key: string
          position: number
          value: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          list_key: string
          position?: number
          value: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          list_key?: string
          position?: number
          value?: string
        }
        Relationships: []
      }
      technician_devices: {
        Row: {
          device_name: string | null
          id: string
          last_seen_at: string | null
          paired_at: string
          person_id: string
          push_token: string | null
          revoked_at: string | null
          secret_hash: string
        }
        Insert: {
          device_name?: string | null
          id?: string
          last_seen_at?: string | null
          paired_at?: string
          person_id: string
          push_token?: string | null
          revoked_at?: string | null
          secret_hash: string
        }
        Update: {
          device_name?: string | null
          id?: string
          last_seen_at?: string | null
          paired_at?: string
          person_id?: string
          push_token?: string | null
          revoked_at?: string | null
          secret_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_devices_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      technician_messages: {
        Row: {
          assignment_id: string | null
          body: string | null
          external_id: string | null
          id: string
          job_id: string | null
          kind: Database["public"]["Enums"]["technician_message_kind"]
          media_paths: string[]
          person_id: string | null
          received_at: string
        }
        Insert: {
          assignment_id?: string | null
          body?: string | null
          external_id?: string | null
          id?: string
          job_id?: string | null
          kind?: Database["public"]["Enums"]["technician_message_kind"]
          media_paths?: string[]
          person_id?: string | null
          received_at?: string
        }
        Update: {
          assignment_id?: string | null
          body?: string | null
          external_id?: string | null
          id?: string
          job_id?: string | null
          kind?: Database["public"]["Enums"]["technician_message_kind"]
          media_paths?: string[]
          person_id?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_messages_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_messages_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      qualification_status: {
        Row: {
          certificate_no: string | null
          certificate_path: string | null
          certifying_body: string | null
          created_at: string | null
          id: string | null
          is_expired: boolean | null
          issued_on: string | null
          level: string | null
          method: Database["public"]["Enums"]["test_method"] | null
          person_id: string | null
          scheme: string | null
          valid_until: string | null
        }
        Insert: {
          certificate_no?: string | null
          certificate_path?: string | null
          certifying_body?: string | null
          created_at?: string | null
          id?: string | null
          is_expired?: never
          issued_on?: string | null
          level?: string | null
          method?: Database["public"]["Enums"]["test_method"] | null
          person_id?: string | null
          scheme?: string | null
          valid_until?: string | null
        }
        Update: {
          certificate_no?: string | null
          certificate_path?: string | null
          certifying_body?: string | null
          created_at?: string | null
          id?: string | null
          is_expired?: never
          issued_on?: string | null
          level?: string | null
          method?: Database["public"]["Enums"]["test_method"] | null
          person_id?: string | null
          scheme?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qualifications_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      list_recycle_bin: {
        Args: Record<PropertyKey, never>
        Returns: {
          deleted_at: string
          deleted_by: string | null
          deleted_by_name: string | null
          detail: string
          label: string
          record_id: string
          table_name: string
        }[]
      }
      restore_record: {
        Args: {
          p_id: string
          p_table: string
        }
        Returns: undefined
      }
      soft_delete_record: {
        Args: {
          p_id: string
          p_table: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "management" | "office" | "reviewer" | "technician"
      enquiry_source: "email" | "phone" | "whatsapp"
      enquiry_status: "new" | "linked" | "quoted" | "converted" | "closed"
      equipment_kind: "ut_flaw_detector" | "mpi_yoke"
      invoice_kind: "proforma" | "tax_invoice"
      job_status:
        | "enquiry_received"
        | "awaiting_approval"
        | "scheduled"
        | "inspection_done"
        | "report_in_review"
        | "report_sent"
        | "invoiced"
        | "closed"
      quotation_status:
        | "draft"
        | "approved"
        | "sent"
        | "accepted"
        | "superseded"
      report_status: "draft" | "in_review" | "returned" | "approved" | "sent"
      technician_message_kind:
        | "acknowledgement"
        | "completion"
        | "delay"
        | "leave"
        | "equipment_problem"
        | "site_issue"
        | "other"
      test_method:
        | "UT"
        | "MPT"
        | "DPT"
        | "RT"
        | "VT"
        | "hardness"
        | "metallography"
        | "RLA"
        | "certification"
        | "general_inspection"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["management", "office", "reviewer", "technician"],
      enquiry_source: ["email", "phone", "whatsapp"],
      enquiry_status: ["new", "linked", "quoted", "converted", "closed"],
      equipment_kind: ["ut_flaw_detector", "mpi_yoke"],
      invoice_kind: ["proforma", "tax_invoice"],
      job_status: [
        "enquiry_received",
        "awaiting_approval",
        "scheduled",
        "inspection_done",
        "report_in_review",
        "report_sent",
        "invoiced",
        "closed",
      ],
      quotation_status: ["draft", "approved", "sent", "accepted", "superseded"],
      report_status: ["draft", "in_review", "returned", "approved", "sent"],
      technician_message_kind: [
        "acknowledgement",
        "completion",
        "delay",
        "leave",
        "equipment_problem",
        "site_issue",
        "other",
      ],
      test_method: [
        "UT",
        "MPT",
        "DPT",
        "RT",
        "VT",
        "hardness",
        "metallography",
        "RLA",
        "certification",
        "general_inspection",
      ],
    },
  },
} as const
