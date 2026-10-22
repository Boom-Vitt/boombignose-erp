import type { Database } from "@/lib/types/database"

export type LeadForm = {
  id: string
  org_id: string
  token: string
  name: string
  enabled: boolean
  default_owner: string | null
  success_message: string
  created_at: string
}

export type LeadFormsDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      lead_forms: {
        Row: LeadForm
        Insert: Pick<LeadForm, "org_id" | "token" | "name"> & Partial<LeadForm>
        Update: Partial<LeadForm>
        Relationships: []
      }
    }
    Functions: Database["public"]["Functions"] & {
      submit_lead_form: {
        Args: { p_token: string; p_ip_hash: string; p_name: string; p_company: string; p_email: string; p_phone: string; p_message: string; p_website: string }
        Returns: string
      }
    }
  }
}
