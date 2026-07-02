export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounting_connections: {
        Row: {
          config: Json
          created_at: string
          id: string
          org_id: string
          provider: Database["public"]["Enums"]["accounting_provider"]
          status: Database["public"]["Enums"]["accounting_conn_status"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          org_id: string
          provider: Database["public"]["Enums"]["accounting_provider"]
          status?: Database["public"]["Enums"]["accounting_conn_status"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          org_id?: string
          provider?: Database["public"]["Enums"]["accounting_provider"]
          status?: Database["public"]["Enums"]["accounting_conn_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_sync_map: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          local_entity: string
          local_id: string
          org_id: string
          provider: Database["public"]["Enums"]["accounting_provider"]
          status: Database["public"]["Enums"]["accounting_sync_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          local_entity: string
          local_id: string
          org_id: string
          provider: Database["public"]["Enums"]["accounting_provider"]
          status?: Database["public"]["Enums"]["accounting_sync_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          local_entity?: string
          local_id?: string
          org_id?: string
          provider?: Database["public"]["Enums"]["accounting_provider"]
          status?: Database["public"]["Enums"]["accounting_sync_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_sync_map_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          body: string | null
          client_id: string | null
          created_at: string
          deal_id: string | null
          done: boolean
          due_date: string | null
          id: string
          org_id: string
          owner: string | null
          type: Database["public"]["Enums"]["activity_type"]
          updated_at: string
        }
        Insert: {
          body?: string | null
          client_id?: string | null
          created_at?: string
          deal_id?: string | null
          done?: boolean
          due_date?: string | null
          id?: string
          org_id: string
          owner?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Update: {
          body?: string | null
          client_id?: string | null
          created_at?: string
          deal_id?: string | null
          done?: boolean
          due_date?: string | null
          id?: string
          org_id?: string
          owner?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_outputs: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          entity: string
          entity_id: string | null
          id: string
          kind: Database["public"]["Enums"]["ai_output_kind"]
          model: string | null
          org_id: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          entity: string
          entity_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["ai_output_kind"]
          model?: string | null
          org_id: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          entity?: string
          entity_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["ai_output_kind"]
          model?: string | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_outputs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          meta: Json
          org_id: string
          summary: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          meta?: Json
          org_id: string
          summary: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          meta?: Json
          org_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_templates: {
        Row: {
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          implementation_checklist: Json
          internal_value_satang: number | null
          name: string
          org_id: string
          price_satang: number | null
          reusable_notes: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          implementation_checklist?: Json
          internal_value_satang?: number | null
          name: string
          org_id: string
          price_satang?: number | null
          reusable_notes?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          implementation_checklist?: Json
          internal_value_satang?: number | null
          name?: string
          org_id?: string
          price_satang?: number | null
          reusable_notes?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "template_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          id: string
          industry: string | null
          name: string
          notes: string | null
          org_id: string
          owner: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          org_id: string
          owner?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          owner?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          client_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          org_id: string
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          org_id: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          org_id?: string
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      costs: {
        Row: {
          amount_satang: number
          category: Database["public"]["Enums"]["cost_category"]
          created_at: string
          id: string
          incurred_on: string
          notes: string | null
          org_id: string
          project_id: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          amount_satang: number
          category?: Database["public"]["Enums"]["cost_category"]
          created_at?: string
          id?: string
          incurred_on?: string
          notes?: string | null
          org_id: string
          project_id?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          amount_satang?: number
          category?: Database["public"]["Enums"]["cost_category"]
          created_at?: string
          id?: string
          incurred_on?: string
          notes?: string | null
          org_id?: string
          project_id?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "costs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          client_id: string
          created_at: string
          currency: string
          expected_close_date: string | null
          id: string
          next_follow_up_date: string | null
          notes: string | null
          org_id: string
          owner: string | null
          source: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          title: string
          updated_at: string
          value_satang: number
        }
        Insert: {
          client_id: string
          created_at?: string
          currency?: string
          expected_close_date?: string | null
          id?: string
          next_follow_up_date?: string | null
          notes?: string | null
          org_id: string
          owner?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          title: string
          updated_at?: string
          value_satang?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          currency?: string
          expected_close_date?: string | null
          id?: string
          next_follow_up_date?: string | null
          notes?: string | null
          org_id?: string
          owner?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          title?: string
          updated_at?: string
          value_satang?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_satang: number
          client_id: string
          created_at: string
          due_date: string | null
          id: string
          is_recurring: boolean
          issue_date: string
          notes: string | null
          number: string
          org_id: string
          project_id: string | null
          recurring_interval:
            | Database["public"]["Enums"]["recurring_interval"]
            | null
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
        }
        Insert: {
          amount_satang?: number
          client_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          is_recurring?: boolean
          issue_date?: string
          notes?: string | null
          number: string
          org_id: string
          project_id?: string | null
          recurring_interval?:
            | Database["public"]["Enums"]["recurring_interval"]
            | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
        }
        Update: {
          amount_satang?: number
          client_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          is_recurring?: boolean
          issue_date?: string
          notes?: string | null
          number?: string
          org_id?: string
          project_id?: string | null
          recurring_interval?:
            | Database["public"]["Enums"]["recurring_interval"]
            | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["role_enum"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["role_enum"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["role_enum"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          created_at: string
          done: boolean
          due_date: string | null
          id: string
          org_id: string
          project_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          due_date?: string | null
          id?: string
          org_id: string
          project_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          done?: boolean
          due_date?: string | null
          id?: string
          org_id?: string
          project_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          cash_balance_satang: number
          created_at: string
          id: string
          monthly_burn_satang: number | null
          org_id: string
          updated_at: string
        }
        Insert: {
          cash_balance_satang?: number
          created_at?: string
          id?: string
          monthly_burn_satang?: number | null
          org_id: string
          updated_at?: string
        }
        Update: {
          cash_balance_satang?: number
          created_at?: string
          id?: string
          monthly_burn_satang?: number | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      outbound_events: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          org_id: string
          payload: Json
          status: Database["public"]["Enums"]["outbound_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          org_id: string
          payload?: Json
          status?: Database["public"]["Enums"]["outbound_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          org_id?: string
          payload?: Json
          status?: Database["public"]["Enums"]["outbound_status"]
        }
        Relationships: [
          {
            foreignKeyName: "outbound_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_satang: number
          created_at: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          org_id: string
          paid_at: string
          updated_at: string
        }
        Insert: {
          amount_satang: number
          created_at?: string
          id?: string
          invoice_id: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          org_id: string
          paid_at?: string
          updated_at?: string
        }
        Update: {
          amount_satang?: number
          created_at?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          org_id?: string
          paid_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_tasks: {
        Row: {
          assignee: string | null
          created_at: string
          done: boolean
          due_date: string | null
          id: string
          org_id: string
          project_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          created_at?: string
          done?: boolean
          due_date?: string | null
          id?: string
          org_id: string
          project_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          created_at?: string
          done?: boolean
          due_date?: string | null
          id?: string
          org_id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_satang: number | null
          client_id: string | null
          created_at: string
          deadline: string | null
          deal_id: string | null
          id: string
          name: string
          org_id: string
          owner: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          budget_satang?: number | null
          client_id?: string | null
          created_at?: string
          deadline?: string | null
          deal_id?: string | null
          id?: string
          name: string
          org_id: string
          owner?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          budget_satang?: number | null
          client_id?: string | null
          created_at?: string
          deadline?: string | null
          deal_id?: string | null
          id?: string
          name?: string
          org_id?: string
          owner?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          channel: Database["public"]["Enums"]["reminder_channel"]
          created_at: string
          due_date: string
          entity: string
          entity_id: string | null
          id: string
          meta: Json
          org_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          title: string
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["reminder_channel"]
          created_at?: string
          due_date: string
          entity: string
          entity_id?: string | null
          id?: string
          meta?: Json
          org_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          title: string
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["reminder_channel"]
          created_at?: string
          due_date?: string
          entity?: string
          entity_id?: string | null
          id?: string
          meta?: Json
          org_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          config: Json
          created_at: string
          id: string
          module: string
          name: string
          org_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          module: string
          name: string
          org_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          module?: string
          name?: string
          org_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      template_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      accounting_conn_status: "disconnected" | "connected" | "error"
      accounting_provider: "flowaccount" | "peak" | "xero"
      accounting_sync_status: "pending" | "synced" | "error"
      activity_type: "note" | "call" | "email" | "meeting" | "follow_up"
      ai_output_kind: "deal_summary" | "followup_draft" | "meeting_intake"
      cost_category:
        | "software"
        | "contractor"
        | "infra"
        | "marketing"
        | "salary"
        | "other"
      deal_stage:
        | "lead"
        | "contacted"
        | "discovery"
        | "proposal"
        | "negotiation"
        | "won"
        | "lost"
      invoice_status:
        | "draft"
        | "sent"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "cancelled"
      outbound_status: "queued" | "delivered" | "failed"
      payment_method:
        | "transfer"
        | "cash"
        | "card"
        | "promptpay"
        | "cheque"
        | "other"
      project_status:
        | "not_started"
        | "in_progress"
        | "review"
        | "delivered"
        | "support"
        | "paused"
        | "cancelled"
      recurring_interval: "weekly" | "monthly" | "quarterly" | "yearly"
      reminder_channel: "line" | "email" | "inapp"
      reminder_status: "pending" | "sent" | "cancelled"
      role_enum: "owner" | "admin" | "member"
      task_status: "todo" | "in_progress" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      accounting_conn_status: ["disconnected", "connected", "error"],
      accounting_provider: ["flowaccount", "peak", "xero"],
      accounting_sync_status: ["pending", "synced", "error"],
      activity_type: ["note", "call", "email", "meeting", "follow_up"],
      ai_output_kind: ["deal_summary", "followup_draft", "meeting_intake"],
      cost_category: [
        "software",
        "contractor",
        "infra",
        "marketing",
        "salary",
        "other",
      ],
      deal_stage: [
        "lead",
        "contacted",
        "discovery",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
      invoice_status: [
        "draft",
        "sent",
        "partially_paid",
        "paid",
        "overdue",
        "cancelled",
      ],
      outbound_status: ["queued", "delivered", "failed"],
      payment_method: [
        "transfer",
        "cash",
        "card",
        "promptpay",
        "cheque",
        "other",
      ],
      project_status: [
        "not_started",
        "in_progress",
        "review",
        "delivered",
        "support",
        "paused",
        "cancelled",
      ],
      recurring_interval: ["weekly", "monthly", "quarterly", "yearly"],
      reminder_channel: ["line", "email", "inapp"],
      reminder_status: ["pending", "sent", "cancelled"],
      role_enum: ["owner", "admin", "member"],
      task_status: ["todo", "in_progress", "done"],
    },
  },
} as const

