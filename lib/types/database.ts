/**
 * Typed database contract for the Supabase client.
 *
 * Hand-authored to match `supabase/migrations`. After running the local stack
 * you can regenerate the canonical version to guarantee parity:
 *
 *   supabase start
 *   supabase gen types typescript --local > lib/types/database.ts
 *
 * Conventions: money columns are `bigint` satang (typed as number), dates are
 * ISO strings (Postgres `date` / `timestamptz`), ids are uuid strings.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; slug: string; created_at: string; updated_at: string }
        Insert: { id?: string; name: string; slug: string; created_at?: string; updated_at?: string }
        Update: { id?: string; name?: string; slug?: string; created_at?: string; updated_at?: string }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string | null
          avatar_url: string | null
          locale: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          avatar_url?: string | null
          locale?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          avatar_url?: string | null
          locale?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      memberships: {
        Row: {
          id: string
          org_id: string
          user_id: string
          role: Database["public"]["Enums"]["role_enum"]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          role?: Database["public"]["Enums"]["role_enum"]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          user_id?: string
          role?: Database["public"]["Enums"]["role_enum"]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          org_id: string
          name: string
          industry: string | null
          source: string | null
          notes: string | null
          owner: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          industry?: string | null
          source?: string | null
          notes?: string | null
          owner?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          industry?: string | null
          source?: string | null
          notes?: string | null
          owner?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          id: string
          org_id: string
          client_id: string
          name: string
          email: string | null
          phone: string | null
          role: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          name: string
          email?: string | null
          phone?: string | null
          role?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          client_id?: string
          name?: string
          email?: string | null
          phone?: string | null
          role?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      deals: {
        Row: {
          id: string
          org_id: string
          client_id: string
          title: string
          stage: Database["public"]["Enums"]["deal_stage"]
          value_satang: number
          currency: string
          expected_close_date: string | null
          next_follow_up_date: string | null
          source: string | null
          notes: string | null
          owner: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          title: string
          stage?: Database["public"]["Enums"]["deal_stage"]
          value_satang?: number
          currency?: string
          expected_close_date?: string | null
          next_follow_up_date?: string | null
          source?: string | null
          notes?: string | null
          owner?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          client_id?: string
          title?: string
          stage?: Database["public"]["Enums"]["deal_stage"]
          value_satang?: number
          currency?: string
          expected_close_date?: string | null
          next_follow_up_date?: string | null
          source?: string | null
          notes?: string | null
          owner?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      activities: {
        Row: {
          id: string
          org_id: string
          client_id: string | null
          deal_id: string | null
          type: Database["public"]["Enums"]["activity_type"]
          due_date: string | null
          done: boolean
          body: string | null
          owner: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id?: string | null
          deal_id?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
          due_date?: string | null
          done?: boolean
          body?: string | null
          owner?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          client_id?: string | null
          deal_id?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
          due_date?: string | null
          done?: boolean
          body?: string | null
          owner?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          id: string
          org_id: string
          deal_id: string | null
          client_id: string | null
          name: string
          status: Database["public"]["Enums"]["project_status"]
          deadline: string | null
          budget_satang: number | null
          owner: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          deal_id?: string | null
          client_id?: string | null
          name: string
          status?: Database["public"]["Enums"]["project_status"]
          deadline?: string | null
          budget_satang?: number | null
          owner?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          deal_id?: string | null
          client_id?: string | null
          name?: string
          status?: Database["public"]["Enums"]["project_status"]
          deadline?: string | null
          budget_satang?: number | null
          owner?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_tasks: {
        Row: {
          id: string
          org_id: string
          project_id: string
          title: string
          status: Database["public"]["Enums"]["task_status"]
          assignee: string | null
          due_date: string | null
          done: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id: string
          title: string
          status?: Database["public"]["Enums"]["task_status"]
          assignee?: string | null
          due_date?: string | null
          done?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          project_id?: string
          title?: string
          status?: Database["public"]["Enums"]["task_status"]
          assignee?: string | null
          due_date?: string | null
          done?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      milestones: {
        Row: {
          id: string
          org_id: string
          project_id: string
          title: string
          done: boolean
          due_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id: string
          title: string
          done?: boolean
          due_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          project_id?: string
          title?: string
          done?: boolean
          due_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          org_id: string
          client_id: string
          project_id: string | null
          number: string
          status: Database["public"]["Enums"]["invoice_status"]
          issue_date: string
          due_date: string | null
          amount_satang: number
          is_recurring: boolean
          recurring_interval: Database["public"]["Enums"]["recurring_interval"] | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          project_id?: string | null
          number: string
          status?: Database["public"]["Enums"]["invoice_status"]
          issue_date?: string
          due_date?: string | null
          amount_satang?: number
          is_recurring?: boolean
          recurring_interval?: Database["public"]["Enums"]["recurring_interval"] | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          client_id?: string
          project_id?: string | null
          number?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          issue_date?: string
          due_date?: string | null
          amount_satang?: number
          is_recurring?: boolean
          recurring_interval?: Database["public"]["Enums"]["recurring_interval"] | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          org_id: string
          invoice_id: string
          amount_satang: number
          paid_at: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          invoice_id: string
          amount_satang: number
          paid_at?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          invoice_id?: string
          amount_satang?: number
          paid_at?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      costs: {
        Row: {
          id: string
          org_id: string
          project_id: string | null
          category: Database["public"]["Enums"]["cost_category"]
          amount_satang: number
          incurred_on: string
          vendor: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          project_id?: string | null
          category?: Database["public"]["Enums"]["cost_category"]
          amount_satang: number
          incurred_on?: string
          vendor?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          project_id?: string | null
          category?: Database["public"]["Enums"]["cost_category"]
          amount_satang?: number
          incurred_on?: string
          vendor?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      template_categories: {
        Row: { id: string; org_id: string; name: string; slug: string; created_at: string; updated_at: string }
        Insert: { id?: string; org_id: string; name: string; slug: string; created_at?: string; updated_at?: string }
        Update: { id?: string; org_id?: string; name?: string; slug?: string; created_at?: string; updated_at?: string }
        Relationships: []
      }
      automation_templates: {
        Row: {
          id: string
          org_id: string
          category_id: string | null
          name: string
          description: string | null
          internal_value_satang: number | null
          price_satang: number | null
          reusable_notes: string | null
          implementation_checklist: Json
          tags: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          category_id?: string | null
          name: string
          description?: string | null
          internal_value_satang?: number | null
          price_satang?: number | null
          reusable_notes?: string | null
          implementation_checklist?: Json
          tags?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          category_id?: string | null
          name?: string
          description?: string | null
          internal_value_satang?: number | null
          price_satang?: number | null
          reusable_notes?: string | null
          implementation_checklist?: Json
          tags?: string[]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: {
      role_enum: "owner" | "admin" | "member"
      deal_stage:
        | "lead"
        | "contacted"
        | "discovery"
        | "proposal"
        | "negotiation"
        | "won"
        | "lost"
      project_status:
        | "not_started"
        | "in_progress"
        | "review"
        | "delivered"
        | "support"
        | "paused"
        | "cancelled"
      invoice_status:
        | "draft"
        | "sent"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "cancelled"
      task_status: "todo" | "in_progress" | "done"
      activity_type: "note" | "call" | "email" | "meeting" | "follow_up"
      payment_method: "transfer" | "cash" | "card" | "promptpay" | "cheque" | "other"
      recurring_interval: "weekly" | "monthly" | "quarterly" | "yearly"
      cost_category:
        | "software"
        | "contractor"
        | "infra"
        | "marketing"
        | "salary"
        | "other"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"]
export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T]
