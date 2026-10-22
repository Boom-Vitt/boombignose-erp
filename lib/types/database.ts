
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "accounting_connections": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"org_id": string,"provider": Database["public"]['Enums']["accounting_provider"],"status": Database["public"]['Enums']["accounting_conn_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"org_id": string,"provider": Database["public"]['Enums']["accounting_provider"],"status"?: Database["public"]['Enums']["accounting_conn_status"],"updated_at"?: string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"org_id"?: string,"provider"?: Database["public"]['Enums']["accounting_provider"],"status"?: Database["public"]['Enums']["accounting_conn_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounting_connections_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"accounting_sync_map": {
                  Row: {
                    "created_at": string,"external_id": string | null,"id": string,"last_error": string | null,"last_synced_at": string | null,"local_entity": string,"local_id": string,"org_id": string,"provider": Database["public"]['Enums']["accounting_provider"],"status": Database["public"]['Enums']["accounting_sync_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"external_id"?: string | null,"id"?: string,"last_error"?: string | null,"last_synced_at"?: string | null,"local_entity": string,"local_id": string,"org_id": string,"provider": Database["public"]['Enums']["accounting_provider"],"status"?: Database["public"]['Enums']["accounting_sync_status"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"external_id"?: string | null,"id"?: string,"last_error"?: string | null,"last_synced_at"?: string | null,"local_entity"?: string,"local_id"?: string,"org_id"?: string,"provider"?: Database["public"]['Enums']["accounting_provider"],"status"?: Database["public"]['Enums']["accounting_sync_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounting_sync_map_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"activities": {
                  Row: {
                    "body": string | null,"client_id": string | null,"created_at": string,"deal_id": string | null,"done": boolean,"due_date": string | null,"id": string,"org_id": string,"owner": string | null,"type": Database["public"]['Enums']["activity_type"],"updated_at": string,"record_type": Database["public"]["Enums"]["record_type"] | null,"record_id": string | null,"completed_at": string | null,"completed_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"client_id"?: string | null,"created_at"?: string,"deal_id"?: string | null,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id": string,"owner"?: string | null,"type"?: Database["public"]['Enums']["activity_type"],"updated_at"?: string,"record_type"?: Database["public"]["Enums"]["record_type"] | null,"record_id"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null
                  }
                  Update: {
                    "body"?: string | null,"client_id"?: string | null,"created_at"?: string,"deal_id"?: string | null,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id"?: string,"owner"?: string | null,"type"?: Database["public"]['Enums']["activity_type"],"updated_at"?: string,"record_type"?: Database["public"]["Enums"]["record_type"] | null,"record_id"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activities_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "activities_deal_id_fkey_tenant"
      columns: ["org_id","deal_id"]
isOneToOne: false
      referencedRelation: "deals"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "activities_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_outputs": {
                  Row: {
                    "content": string,"created_at": string,"created_by": string | null,"entity": string,"entity_id": string | null,"id": string,"kind": Database["public"]['Enums']["ai_output_kind"],"model": string | null,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"created_at"?: string,"created_by"?: string | null,"entity": string,"entity_id"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["ai_output_kind"],"model"?: string | null,"org_id": string
                  }
                  Update: {
                    "content"?: string,"created_at"?: string,"created_by"?: string | null,"entity"?: string,"entity_id"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["ai_output_kind"],"model"?: string | null,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_outputs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_email": string | null,"actor_id": string | null,"created_at": string,"entity": string,"entity_id": string | null,"id": string,"meta": NonNullable<Json>,"org_id": string,"summary": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_email"?: string | null,"actor_id"?: string | null,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"org_id": string,"summary": string
                  }
                  Update: {
                    "action"?: string,"actor_email"?: string | null,"actor_id"?: string | null,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"org_id"?: string,"summary"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"automation_templates": {
                  Row: {
                    "category_id": string | null,"created_at": string,"description": string | null,"id": string,"implementation_checklist": NonNullable<Json>,"internal_value_satang": number | null,"name": string,"org_id": string,"price_satang": number | null,"reusable_notes": string | null,"tags": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"implementation_checklist"?: NonNullable<Json>,"internal_value_satang"?: number | null,"name": string,"org_id": string,"price_satang"?: number | null,"reusable_notes"?: string | null,"tags"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"implementation_checklist"?: NonNullable<Json>,"internal_value_satang"?: number | null,"name"?: string,"org_id"?: string,"price_satang"?: number | null,"reusable_notes"?: string | null,"tags"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_templates_category_id_fkey_tenant"
      columns: ["org_id","category_id"]
isOneToOne: false
      referencedRelation: "template_categories"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "automation_templates_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "billing_address": string | null,"created_at": string,"id": string,"industry": string | null,"name": string,"notes": string | null,"org_id": string,"owner": string | null,"portal_enabled": boolean,"portal_token": string | null,"source": string | null,"tax_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billing_address"?: string | null,"created_at"?: string,"id"?: string,"industry"?: string | null,"name": string,"notes"?: string | null,"org_id": string,"owner"?: string | null,"portal_enabled"?: boolean,"portal_token"?: string | null,"source"?: string | null,"tax_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "billing_address"?: string | null,"created_at"?: string,"id"?: string,"industry"?: string | null,"name"?: string,"notes"?: string | null,"org_id"?: string,"owner"?: string | null,"portal_enabled"?: boolean,"portal_token"?: string | null,"source"?: string | null,"tax_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "client_id": string,"created_at": string,"email": string | null,"id": string,"name": string,"org_id": string,"phone": string | null,"role": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"email"?: string | null,"id"?: string,"name": string,"org_id": string,"phone"?: string | null,"role"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"email"?: string | null,"id"?: string,"name"?: string,"org_id"?: string,"phone"?: string | null,"role"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "contacts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"costs": {
                  Row: {
                    "amount_satang": number,"category": Database["public"]['Enums']["cost_category"],"created_at": string,"id": string,"incurred_on": string,"notes": string | null,"org_id": string,"project_id": string | null,"updated_at": string,"vendor": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang": number,"category"?: Database["public"]['Enums']["cost_category"],"created_at"?: string,"id"?: string,"incurred_on"?: string,"notes"?: string | null,"org_id": string,"project_id"?: string | null,"updated_at"?: string,"vendor"?: string | null
                  }
                  Update: {
                    "amount_satang"?: number,"category"?: Database["public"]['Enums']["cost_category"],"created_at"?: string,"id"?: string,"incurred_on"?: string,"notes"?: string | null,"org_id"?: string,"project_id"?: string | null,"updated_at"?: string,"vendor"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "costs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "costs_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"deals": {
                  Row: {
                    "client_id": string,"created_at": string,"currency": string,"expected_close_date": string | null,"id": string,"next_follow_up_date": string | null,"notes": string | null,"org_id": string,"owner": string | null,"source": string | null,"stage": Database["public"]['Enums']["deal_stage"],"title": string,"updated_at": string,"value_satang": number
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"currency"?: string,"expected_close_date"?: string | null,"id"?: string,"next_follow_up_date"?: string | null,"notes"?: string | null,"org_id": string,"owner"?: string | null,"source"?: string | null,"stage"?: Database["public"]['Enums']["deal_stage"],"title": string,"updated_at"?: string,"value_satang"?: number
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"currency"?: string,"expected_close_date"?: string | null,"id"?: string,"next_follow_up_date"?: string | null,"notes"?: string | null,"org_id"?: string,"owner"?: string | null,"source"?: string | null,"stage"?: Database["public"]['Enums']["deal_stage"],"title"?: string,"updated_at"?: string,"value_satang"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "deals_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "deals_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"document_counters": {
                  Row: {
                    "kind": string,"org_id": string,"value": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"org_id": string,"value": number,"year": number
                  }
                  Update: {
                    "kind"?: string,"org_id"?: string,"value"?: number,"year"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_counters_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"integration_receipts": {
                  Row: {
                    "created_at": string,"event_type": string,"id": string,"key": string,"org_id": string,"payload": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_type": string,"id"?: string,"key": string,"org_id": string,"payload": NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"event_type"?: string,"id"?: string,"key"?: string,"org_id"?: string,"payload"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "integration_receipts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_by": string | null,"created_at": string,"email": string,"expires_at": string | null,"id": string,"invited_by": string | null,"org_id": string,"role": Database["public"]['Enums']["role_enum"],"status": Database["public"]['Enums']["invitation_status"],"token": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string | null,"id"?: string,"invited_by"?: string | null,"org_id": string,"role"?: Database["public"]['Enums']["role_enum"],"status"?: Database["public"]['Enums']["invitation_status"],"token": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string | null,"id"?: string,"invited_by"?: string | null,"org_id"?: string,"role"?: Database["public"]['Enums']["role_enum"],"status"?: Database["public"]['Enums']["invitation_status"],"token"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_issue_requests": {
                  Row: {
                    "invoice_id": string,"key": string,"org_id": string,"snapshot_id": string | null,"source_version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "invoice_id": string,"key": string,"org_id": string,"snapshot_id"?: string | null,"source_version": number
                  }
                  Update: {
                    "invoice_id"?: string,"key"?: string,"org_id"?: string,"snapshot_id"?: string | null,"source_version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_issue_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_issue_requests_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoice_issue_requests_org_id_snapshot_id_fkey"
      columns: ["org_id","snapshot_id"]
isOneToOne: false
      referencedRelation: "invoice_snapshots"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"invoice_items": {
                  Row: {
                    "amount_satang": number,"created_at": string,"description": string,"id": string,"invoice_id": string,"org_id": string,"position": number,"quantity": number,"unit_price_satang": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang"?: number,"created_at"?: string,"description": string,"id"?: string,"invoice_id": string,"org_id": string,"position"?: number,"quantity"?: number,"unit_price_satang"?: number,"updated_at"?: string
                  }
                  Update: {
                    "amount_satang"?: number,"created_at"?: string,"description"?: string,"id"?: string,"invoice_id"?: string,"org_id"?: string,"position"?: number,"quantity"?: number,"unit_price_satang"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_items_invoice_tenant_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoice_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_snapshots": {
                  Row: {
                    "id": string,"invoice_id": string,"issued_at": string,"issued_by": string,"number": string,"org_id": string,"snapshot": NonNullable<Json>,"source_version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"invoice_id": string,"issued_at"?: string,"issued_by": string,"number": string,"org_id": string,"snapshot": NonNullable<Json>,"source_version": number
                  }
                  Update: {
                    "id"?: string,"invoice_id"?: string,"issued_at"?: string,"issued_by"?: string,"number"?: string,"org_id"?: string,"snapshot"?: NonNullable<Json>,"source_version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_snapshots_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_snapshots_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: true
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "amount_satang": number,"client_id": string,"created_at": string,"discount_satang": number,"due_date": string | null,"id": string,"is_recurring": boolean,"issue_date": string,"issued_snapshot_id": string | null,"notes": string | null,"number": string,"org_id": string,"project_id": string | null,"recurring_interval": Database["public"]['Enums']["recurring_interval"] | null,"source_milestone_id": string | null,"source_quote_id": string | null,"status": Database["public"]['Enums']["invoice_status"],"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang"?: number,"client_id": string,"created_at"?: string,"discount_satang"?: number,"due_date"?: string | null,"id"?: string,"is_recurring"?: boolean,"issue_date"?: string,"issued_snapshot_id"?: string | null,"notes"?: string | null,"number": string,"org_id": string,"project_id"?: string | null,"recurring_interval"?: Database["public"]['Enums']["recurring_interval"] | null,"source_milestone_id"?: string | null,"source_quote_id"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "amount_satang"?: number,"client_id"?: string,"created_at"?: string,"discount_satang"?: number,"due_date"?: string | null,"id"?: string,"is_recurring"?: boolean,"issue_date"?: string,"issued_snapshot_id"?: string | null,"notes"?: string | null,"number"?: string,"org_id"?: string,"project_id"?: string | null,"recurring_interval"?: Database["public"]['Enums']["recurring_interval"] | null,"source_milestone_id"?: string | null,"source_quote_id"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_snapshot_tenant"
      columns: ["org_id","issued_snapshot_id"]
isOneToOne: false
      referencedRelation: "invoice_snapshots"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoices_client_tenant_fkey"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoices_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoices_source_milestone_tenant"
      columns: ["org_id","source_milestone_id"]
isOneToOne: false
      referencedRelation: "milestones"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoices_source_quote_tenant"
      columns: ["org_id","source_quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"id": string,"org_id": string,"role": Database["public"]['Enums']["role_enum"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"org_id": string,"role"?: Database["public"]['Enums']["role_enum"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["role_enum"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"milestones": {
                  Row: {
                    "created_at": string,"done": boolean,"due_date": string | null,"id": string,"org_id": string,"project_id": string,"source_quote_id": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id": string,"project_id": string,"source_quote_id"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id"?: string,"project_id"?: string,"source_quote_id"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "milestones_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "milestones_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "milestones_source_quote_tenant"
      columns: ["org_id","source_quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"org_settings": {
                  Row: {
                    "business_address": string | null,"cash_balance_satang": number,"created_at": string,"id": string,"legal_name": string | null,"monthly_burn_satang": number | null,"org_id": string,"tax_id": string | null,"tax_status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_address"?: string | null,"cash_balance_satang"?: number,"created_at"?: string,"id"?: string,"legal_name"?: string | null,"monthly_burn_satang"?: number | null,"org_id": string,"tax_id"?: string | null,"tax_status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "business_address"?: string | null,"cash_balance_satang"?: number,"created_at"?: string,"id"?: string,"legal_name"?: string | null,"monthly_burn_satang"?: number | null,"org_id"?: string,"tax_id"?: string | null,"tax_status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"outbound_events": {
                  Row: {
                    "attempts": number,"created_at": string,"delivered_at": string | null,"event_type": string,"id": string,"last_error": string | null,"lease_expires_at": string | null,"lease_token": string | null,"next_attempt_at": string,"org_id": string,"payload": NonNullable<Json>,"reminder_id": string | null,"status": Database["public"]['Enums']["outbound_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"delivered_at"?: string | null,"event_type": string,"id"?: string,"last_error"?: string | null,"lease_expires_at"?: string | null,"lease_token"?: string | null,"next_attempt_at"?: string,"org_id": string,"payload"?: NonNullable<Json>,"reminder_id"?: string | null,"status"?: Database["public"]['Enums']["outbound_status"]
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"delivered_at"?: string | null,"event_type"?: string,"id"?: string,"last_error"?: string | null,"lease_expires_at"?: string | null,"lease_token"?: string | null,"next_attempt_at"?: string,"org_id"?: string,"payload"?: NonNullable<Json>,"reminder_id"?: string | null,"status"?: Database["public"]['Enums']["outbound_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbound_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbound_reminder_tenant"
      columns: ["org_id","reminder_id"]
isOneToOne: false
      referencedRelation: "reminders"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"payment_allocations": {
                  Row: {
                    "amount_satang": number,"created_at": string,"id": string,"invoice_id": string,"org_id": string,"payment_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang": number,"created_at"?: string,"id"?: string,"invoice_id": string,"org_id": string,"payment_id": string
                  }
                  Update: {
                    "amount_satang"?: number,"created_at"?: string,"id"?: string,"invoice_id"?: string,"org_id"?: string,"payment_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_allocations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_allocations_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "payment_allocations_org_id_payment_id_fkey"
      columns: ["org_id","payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"payment_claims": {
                  Row: {
                    "amount_satang": number,"client_id": string,"created_at": string,"id": string,"idempotency_key": string,"invoice_id": string,"org_id": string,"payment_id": string | null,"reference": string,"review_reference": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"source": string,"status": string,"submitted_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang": number,"client_id": string,"created_at"?: string,"id"?: string,"idempotency_key": string,"invoice_id": string,"org_id": string,"payment_id"?: string | null,"reference": string,"review_reference"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source"?: string,"status"?: string,"submitted_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_satang"?: number,"client_id"?: string,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"invoice_id"?: string,"org_id"?: string,"payment_id"?: string | null,"reference"?: string,"review_reference"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source"?: string,"status"?: string,"submitted_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_claims_org_id_client_id_fkey"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "payment_claims_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_claims_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "payment_claims_org_id_payment_id_fkey"
      columns: ["org_id","payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"payment_command_results": {
                  Row: {
                    "created_at": string,"key": string,"org_id": string,"request": NonNullable<Json>,"result": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string,"org_id": string,"request": NonNullable<Json>,"result"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"key"?: string,"org_id"?: string,"request"?: NonNullable<Json>,"result"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_command_results_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_satang": number,"command_key": string | null,"created_at": string,"id": string,"invoice_id": string,"method": Database["public"]['Enums']["payment_method"],"notes": string | null,"org_id": string,"paid_at": string,"reconciled_payment_id": string | null,"updated_at": string,"verification_reference": string | null,"verification_state": string,"verified_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang": number,"command_key"?: string | null,"created_at"?: string,"id"?: string,"invoice_id": string,"method"?: Database["public"]['Enums']["payment_method"],"notes"?: string | null,"org_id": string,"paid_at"?: string,"reconciled_payment_id"?: string | null,"updated_at"?: string,"verification_reference"?: string | null,"verification_state"?: string,"verified_by"?: string | null
                  }
                  Update: {
                    "amount_satang"?: number,"command_key"?: string | null,"created_at"?: string,"id"?: string,"invoice_id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"notes"?: string | null,"org_id"?: string,"paid_at"?: string,"reconciled_payment_id"?: string | null,"updated_at"?: string,"verification_reference"?: string | null,"verification_state"?: string,"verified_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_invoice_tenant_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "payments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_reconciled_tenant"
      columns: ["org_id","reconciled_payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"portal_claim_requests": {
                  Row: {
                    "created_at": string,"key": string,"org_id": string,"request": NonNullable<Json>,"result": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string,"org_id": string,"request": NonNullable<Json>,"result"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"key"?: string,"org_id"?: string,"request"?: NonNullable<Json>,"result"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "portal_claim_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "portal_claim_requests_org_id_result_fkey"
      columns: ["org_id","result"]
isOneToOne: false
      referencedRelation: "payment_claims"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"full_name": string | null,"id": string,"locale": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string | null,"id": string,"locale"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string | null,"id"?: string,"locale"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"project_tasks": {
                  Row: {
                    "assignee": string | null,"created_at": string,"done": boolean,"due_date": string | null,"id": string,"org_id": string,"project_id": string,"status": Database["public"]['Enums']["task_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee"?: string | null,"created_at"?: string,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id": string,"project_id": string,"status"?: Database["public"]['Enums']["task_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "assignee"?: string | null,"created_at"?: string,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id"?: string,"project_id"?: string,"status"?: Database["public"]['Enums']["task_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_tasks_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_tasks_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "budget_satang": number | null,"client_id": string | null,"created_at": string,"deadline": string | null,"deal_id": string | null,"id": string,"name": string,"org_id": string,"owner": string | null,"source_quote_id": string | null,"status": Database["public"]['Enums']["project_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "budget_satang"?: number | null,"client_id"?: string | null,"created_at"?: string,"deadline"?: string | null,"deal_id"?: string | null,"id"?: string,"name": string,"org_id": string,"owner"?: string | null,"source_quote_id"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"updated_at"?: string
                  }
                  Update: {
                    "budget_satang"?: number | null,"client_id"?: string | null,"created_at"?: string,"deadline"?: string | null,"deal_id"?: string | null,"id"?: string,"name"?: string,"org_id"?: string,"owner"?: string | null,"source_quote_id"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "projects_deal_id_fkey_tenant"
      columns: ["org_id","deal_id"]
isOneToOne: false
      referencedRelation: "deals"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "projects_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_source_quote_tenant"
      columns: ["org_id","source_quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"quote_conversion_requests": {
                  Row: {
                    "created_at": string,"invoice_id": string | null,"key": string,"org_id": string,"quote_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"invoice_id"?: string | null,"key": string,"org_id": string,"quote_id": string
                  }
                  Update: {
                    "created_at"?: string,"invoice_id"?: string | null,"key"?: string,"org_id"?: string,"quote_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_conversion_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_conversion_requests_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quote_conversion_requests_org_id_quote_id_fkey"
      columns: ["org_id","quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"quote_items": {
                  Row: {
                    "amount_satang": number,"created_at": string,"description": string,"id": string,"org_id": string,"position": number,"quantity": number,"quote_id": string,"unit_price_satang": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang"?: number,"created_at"?: string,"description": string,"id"?: string,"org_id": string,"position"?: number,"quantity"?: number,"quote_id": string,"unit_price_satang"?: number,"updated_at"?: string
                  }
                  Update: {
                    "amount_satang"?: number,"created_at"?: string,"description"?: string,"id"?: string,"org_id"?: string,"position"?: number,"quantity"?: number,"quote_id"?: string,"unit_price_satang"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_items_quote_id_fkey_tenant"
      columns: ["org_id","quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "client_id": string,"converted_invoice_id": string | null,"created_at": string,"discount_satang": number,"id": string,"issue_date": string,"notes": string | null,"number": string,"org_id": string,"owner": string | null,"project_id": string | null,"status": Database["public"]['Enums']["quote_status"],"subtotal_satang": number,"total_satang": number,"updated_at": string,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"converted_invoice_id"?: string | null,"created_at"?: string,"discount_satang"?: number,"id"?: string,"issue_date"?: string,"notes"?: string | null,"number": string,"org_id": string,"owner"?: string | null,"project_id"?: string | null,"status"?: Database["public"]['Enums']["quote_status"],"subtotal_satang"?: number,"total_satang"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Update: {
                    "client_id"?: string,"converted_invoice_id"?: string | null,"created_at"?: string,"discount_satang"?: number,"id"?: string,"issue_date"?: string,"notes"?: string | null,"number"?: string,"org_id"?: string,"owner"?: string | null,"project_id"?: string | null,"status"?: Database["public"]['Enums']["quote_status"],"subtotal_satang"?: number,"total_satang"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quotes_converted_invoice_tenant"
      columns: ["org_id","converted_invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quotes_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"reminders": {
                  Row: {
                    "channel": Database["public"]['Enums']["reminder_channel"],"created_at": string,"due_date": string,"entity": string,"entity_id": string | null,"id": string,"meta": NonNullable<Json>,"org_id": string,"sent_at": string | null,"status": Database["public"]['Enums']["reminder_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel"?: Database["public"]['Enums']["reminder_channel"],"created_at"?: string,"due_date": string,"entity": string,"entity_id"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"org_id": string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["reminder_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "channel"?: Database["public"]['Enums']["reminder_channel"],"created_at"?: string,"due_date"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"org_id"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["reminder_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reminders_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_views": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"module": string,"name": string,"org_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"module": string,"name": string,"org_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"module"?: string,"name"?: string,"org_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_views_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"subscription_occurrences": {
                  Row: {
                    "created_at": string,"invoice_id": string,"occurrence_date": string,"org_id": string,"subscription_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"invoice_id": string,"occurrence_date": string,"org_id": string,"subscription_id": string
                  }
                  Update: {
                    "created_at"?: string,"invoice_id"?: string,"occurrence_date"?: string,"org_id"?: string,"subscription_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscription_occurrences_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscription_occurrences_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: true
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "subscription_occurrences_org_id_subscription_id_fkey"
      columns: ["org_id","subscription_id"]
isOneToOne: false
      referencedRelation: "subscriptions"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
                    "amount_satang": number,"auto_generate": boolean,"client_id": string,"created_at": string,"id": string,"interval": Database["public"]['Enums']["recurring_interval"],"last_generated_on": string | null,"name": string,"next_run_date": string,"notes": string | null,"org_id": string,"project_id": string | null,"start_date": string,"status": Database["public"]['Enums']["subscription_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang"?: number,"auto_generate"?: boolean,"client_id": string,"created_at"?: string,"id"?: string,"interval"?: Database["public"]['Enums']["recurring_interval"],"last_generated_on"?: string | null,"name": string,"next_run_date"?: string,"notes"?: string | null,"org_id": string,"project_id"?: string | null,"start_date"?: string,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string
                  }
                  Update: {
                    "amount_satang"?: number,"auto_generate"?: boolean,"client_id"?: string,"created_at"?: string,"id"?: string,"interval"?: Database["public"]['Enums']["recurring_interval"],"last_generated_on"?: string | null,"name"?: string,"next_run_date"?: string,"notes"?: string | null,"org_id"?: string,"project_id"?: string | null,"start_date"?: string,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "subscriptions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"template_categories": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "template_categories_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"time_entries": {
                  Row: {
                    "billable": boolean,"created_at": string,"id": string,"minutes": number,"notes": string | null,"org_id": string,"project_id": string,"rate_satang": number | null,"task_id": string | null,"updated_at": string,"user_id": string | null,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "billable"?: boolean,"created_at"?: string,"id"?: string,"minutes": number,"notes"?: string | null,"org_id": string,"project_id": string,"rate_satang"?: number | null,"task_id"?: string | null,"updated_at"?: string,"user_id"?: string | null,"work_date"?: string
                  }
                  Update: {
                    "billable"?: boolean,"created_at"?: string,"id"?: string,"minutes"?: number,"notes"?: string | null,"org_id"?: string,"project_id"?: string,"rate_satang"?: number | null,"task_id"?: string | null,"updated_at"?: string,"user_id"?: string | null,"work_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_entries_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_entries_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "time_entries_task_id_fkey_tenant"
      columns: ["org_id","task_id"]
isOneToOne: false
      referencedRelation: "project_tasks"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"workspace_requests": {
                  Row: {
                    "created_at": string,"key": string,"name": string,"org_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string,"name": string,"org_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"key"?: string,"name"?: string,"org_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }

      record_notes: {
        Row: { id: string; org_id: string; record_type: Database["public"]["Enums"]["record_type"]; record_id: string; author: string; body: string; created_at: string }
        Insert: { id?: string; org_id: string; record_type: Database["public"]["Enums"]["record_type"]; record_id: string; author: string; body: string; created_at?: string }
        Update: { id?: string; org_id?: string; record_type?: Database["public"]["Enums"]["record_type"]; record_id?: string; author?: string; body?: string; created_at?: string }
        Relationships: []
      }

      record_attachments: {
        Row: { id: string; org_id: string; record_type: Database["public"]["Enums"]["record_type"]; record_id: string; path: string; filename: string; size: number; content_type: string; uploaded_by: string; created_at: string }
        Insert: { id?: string; org_id: string; record_type: Database["public"]["Enums"]["record_type"]; record_id: string; path: string; filename: string; size: number; content_type: string; uploaded_by: string; created_at?: string }
        Update: { id?: string; org_id?: string; record_type?: Database["public"]["Enums"]["record_type"]; record_id?: string; path?: string; filename?: string; size?: number; content_type?: string; uploaded_by?: string; created_at?: string }
        Relationships: []
      }
}
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_integration_event":
{ Args: { "p_event_type": string,"p_key": string,"p_org_id": string,"p_payload": Json }; Returns: Json
                           },
"accept_workspace_invitation":
{ Args: { "p_token": string }; Returns: string
                           },
"claim_outbound_events":
{ Args: { "p_lease_seconds": number,"p_limit": number }; Returns: Json
                           },
"convert_accepted_quote":
{ Args: { "p_key": string,"p_org_id": string,"p_quote_id": string }; Returns: string
                           },
"enqueue_reminders":
{ Args: { "p_org_id": string,"p_specs": Json }; Returns: Json
                           },
"finish_outbound_event":
{ Args: { "p_error"?: string,"p_event_id": string,"p_lease_token": string }; Returns: boolean
                           },
"generate_subscription_occurrence":
{ Args: { "p_occurrence": string,"p_org_id": string,"p_subscription_id": string }; Returns: string
                           },
"issue_invoice":
{ Args: { "p_expected_version": number,"p_invoice_id": string,"p_key": string,"p_org_id": string }; Returns: string
                           },
"provision_hosted_workspace":
{ Args: { "p_key": string,"p_name": string }; Returns: string
                           },
"provision_workspace":
{ Args: { "p_key": string,"p_name": string }; Returns: string
                           },
"reconcile_legacy_payment":
{ Args: { "p_amount_satang": number,"p_key": string,"p_legacy_payment_id": string,"p_org_id": string,"p_reference": string }; Returns: string
                           },
"reconcile_legacy_payment_with_evidence":
{ Args: { "p_amount_satang": number,"p_key": string,"p_legacy_payment_id": string,"p_method": Database["public"]['Enums']["payment_method"],"p_org_id": string,"p_paid_on": string,"p_reference": string }; Returns: string
                           },
"review_payment_claim":
{ Args: { "p_amount_satang": number,"p_claim_id": string,"p_decision": string,"p_key": string,"p_org_id": string,"p_reference": string }; Returns: string
                           },
"review_payment_claim_with_evidence":
{ Args: { "p_amount_satang": number,"p_claim_id": string,"p_decision": string,"p_key": string,"p_method": Database["public"]['Enums']["payment_method"],"p_org_id": string,"p_paid_on": string,"p_reference": string }; Returns: string
                           },
"submit_internal_payment_claim":
{ Args: { "p_amount_satang": number,"p_invoice_id": string,"p_key": string,"p_org_id": string,"p_reference": string }; Returns: string
                           },
"submit_payment_claim":
{ Args: { "p_amount_satang": number,"p_invoice_id": string,"p_key": string,"p_reference": string,"p_token": string }; Returns: string
                           },
"update_business_profile":
{ Args: { "p_business_address": string,"p_legal_name": string,"p_org_id": string,"p_tax_id": string,"p_tax_status": string }; Returns: undefined
                           }
            record_activity_assignees: { Args: { p_org_id: string }; Returns: { user_id: string; full_name: string | null }[] }
          }
          Enums: {
            "accounting_conn_status": "disconnected"|"connected"|"error","accounting_provider": "flowaccount"|"peak"|"xero","accounting_sync_status": "pending"|"synced"|"error","activity_type": "note"|"call"|"email"|"meeting"|"follow_up","ai_output_kind": "deal_summary"|"followup_draft"|"meeting_intake","cost_category": "software"|"contractor"|"infra"|"marketing"|"salary"|"other","deal_stage": "lead"|"contacted"|"discovery"|"proposal"|"negotiation"|"won"|"lost","invitation_status": "pending"|"accepted"|"revoked"|"expired","invoice_status": "draft"|"sent"|"partially_paid"|"paid"|"overdue"|"cancelled","outbound_status": "queued"|"delivered"|"failed","payment_method": "transfer"|"cash"|"card"|"promptpay"|"cheque"|"other","project_status": "not_started"|"in_progress"|"review"|"delivered"|"support"|"paused"|"cancelled","quote_status": "draft"|"sent"|"accepted"|"declined"|"expired"|"converted","recurring_interval": "weekly"|"monthly"|"quarterly"|"yearly","reminder_channel": "line"|"email"|"inapp","reminder_status": "pending"|"sent"|"cancelled","role_enum": "owner"|"admin"|"member","subscription_status": "active"|"paused"|"cancelled","task_status": "todo"|"in_progress"|"done"
      record_type: "client" | "deal" | "quote" | "invoice" | "project" | "subscription"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {

          }
        },"public": {
          Enums: {
            "accounting_conn_status": ["disconnected", "connected", "error"],"accounting_provider": ["flowaccount", "peak", "xero"],"accounting_sync_status": ["pending", "synced", "error"],"activity_type": ["note", "call", "email", "meeting", "follow_up"],"ai_output_kind": ["deal_summary", "followup_draft", "meeting_intake"],"cost_category": ["software", "contractor", "infra", "marketing", "salary", "other"],"deal_stage": ["lead", "contacted", "discovery", "proposal", "negotiation", "won", "lost"],"invitation_status": ["pending", "accepted", "revoked", "expired"],"invoice_status": ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"],"outbound_status": ["queued", "delivered", "failed"],"payment_method": ["transfer", "cash", "card", "promptpay", "cheque", "other"],"project_status": ["not_started", "in_progress", "review", "delivered", "support", "paused", "cancelled"],"quote_status": ["draft", "sent", "accepted", "declined", "expired", "converted"],"recurring_interval": ["weekly", "monthly", "quarterly", "yearly"],"reminder_channel": ["line", "email", "inapp"],"reminder_status": ["pending", "sent", "cancelled"],"role_enum": ["owner", "admin", "member"],"subscription_status": ["active", "paused", "cancelled"],"task_status": ["todo", "in_progress", "done"],
            record_type: ["client", "deal", "quote", "invoice", "project", "subscription"]
          }
        }
} as const
