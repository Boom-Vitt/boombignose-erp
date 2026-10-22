-- ════════════════════════════════════════════════════════════════════════════
-- BoomBigNose Company OS — demo seed (FAKE data only).
--
-- Runs via the service role / superuser (bypasses RLS). Idempotent.
-- Demo logins (LOCAL ONLY):  password for all = BoomDemo123!
--   demo@boombignose.org       (owner / founder)
--   nattapong@boombignose.org  (member / junior dev)
--   praewa@boombignose.org     (member / junior dev)
--
-- All names, emails (@boombignose.org / example.com), and phone numbers are
-- fictional. No real personal data.
-- ════════════════════════════════════════════════════════════════════════════

-- Evaluate current_date / now() in the app's timezone so the seed's "today" and
-- "this month" line up with the dashboard (which reckons in Asia/Bangkok).
set time zone 'Asia/Bangkok';

-- ── Auth users (email + password, pre-confirmed) ────────────────────────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-000000000001','authenticated','authenticated','demo@boombignose.org',      crypt('BoomDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Boom (Founder)"}',          now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-000000000002','authenticated','authenticated','nattapong@boombignose.org', crypt('BoomDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Nattapong (Junior Dev)"}',  now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','b0000000-0000-0000-0000-000000000003','authenticated','authenticated','praewa@boombignose.org',    crypt('BoomDemo123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"full_name":"Praewa (Junior Dev)"}',     now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
  (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','{"sub":"b0000000-0000-0000-0000-000000000001","email":"demo@boombignose.org","email_verified":true}',     'email', now(), now(), now()),
  (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002','{"sub":"b0000000-0000-0000-0000-000000000002","email":"nattapong@boombignose.org","email_verified":true}','email', now(), now(), now()),
  (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000003','{"sub":"b0000000-0000-0000-0000-000000000003","email":"praewa@boombignose.org","email_verified":true}',   'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

-- Profiles (belt-and-braces; the on_auth_user_created trigger also creates these)
insert into public.profiles (id, full_name, locale) values
  ('b0000000-0000-0000-0000-000000000001','Boom (Founder)','th'),
  ('b0000000-0000-0000-0000-000000000002','Nattapong (Junior Dev)','th'),
  ('b0000000-0000-0000-0000-000000000003','Praewa (Junior Dev)','th')
on conflict (id) do update set full_name = excluded.full_name;

-- ── Organization + settings + memberships ───────────────────────────────────
insert into organizations (id, name, slug) values
  ('a0000000-0000-0000-0000-000000000001','BoomBigNose AI','boombignose')
on conflict (id) do nothing;

insert into org_settings (org_id, cash_balance_satang, monthly_burn_satang) values
  ('a0000000-0000-0000-0000-000000000001', 85000000, null)  -- ฿850,000 cash on hand
on conflict (org_id) do nothing;

insert into memberships (org_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','owner'),
  ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','member'),
  ('a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000003','member')
on conflict (user_id, org_id) do nothing;

-- ── CRM: clients ────────────────────────────────────────────────────────────
insert into clients (id, org_id, name, industry, source, notes, owner) values
  ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Doi Chang Origin Coffee','F&B / Retail','Referral','SME coffee roaster, 4 branches in Chiang Mai. Wants a LINE sales-support bot.','b0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Krua Thai Delight Co.','Restaurant Chain','LINE OA','8-branch Thai restaurant group. Manual order follow-up is a mess.','b0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','Lanna EdTech Academy','Education','Webinar','Online course business. Needs student onboarding + community automation.','b0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','Siam Property Hub','Real Estate','Cold outreach','Property agency. Drowning in lead follow-ups and overdue invoices.','b0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','GreenLeaf Organic','Agriculture / E-commerce','Referral','Organic farm with a Shopify store. Wants meeting summaries + ops automation.','b0000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

-- ── CRM: contacts ───────────────────────────────────────────────────────────
insert into contacts (org_id, client_id, name, email, phone, role) values
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Khun Anan','anan@example.com','02-555-0101','Owner'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Khun Mali','mali@example.com','02-555-0102','Marketing Lead'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','Khun Somchai','somchai@example.com','02-555-0201','Operations Manager'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','Dr. Pichai','pichai@example.com','02-555-0301','Founder'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','Khun Wachira','wachira@example.com','02-555-0401','Sales Director'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000005','Khun Ploy','ploy@example.com','02-555-0501','Co-founder')
on conflict do nothing;

-- ── CRM: deals (mix of stages) ──────────────────────────────────────────────
insert into deals (id, org_id, client_id, title, stage, value_satang, expected_close_date, next_follow_up_date, source, notes, owner) values
  ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','LINE Sales-Support Bot',          'won',        18000000, current_date - 20, null,               'Referral','Closed. Moving to delivery.','b0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','n8n CRM Follow-up Automation',    'won',        25000000, current_date - 10, null,               'LINE OA','Closed. Kickoff next week.','b0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','Course Onboarding Workflow',      'won',        15000000, current_date - 35, null,               'Webinar','Closed last month. In support.','b0000000-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','Invoice Overdue Reminder System', 'proposal',   22000000, current_date + 14, current_date,       'Cold outreach','Proposal sent. Follow up today.','b0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000005','Meeting Summary + Ops Bot',       'negotiation',32000000, current_date + 7,  current_date - 2,   'Referral','Negotiating scope. Follow-up overdue!','b0000000-0000-0000-0000-000000000003'),
  ('d0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','AI Tutor Add-on',                 'discovery',  12000000, current_date + 30, current_date + 3,   'Webinar','Exploring an AI tutor module.','b0000000-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','Loyalty Campaign Automation',     'lead',        8000000, current_date + 45, current_date + 5,   'LINE OA','New lead from existing client.','b0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','Website Chatbot (lost)',          'lost',        9000000, current_date - 5,  null,               'Cold outreach','Lost to in-house build.','b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ── CRM: activities / follow-ups ────────────────────────────────────────────
insert into activities (org_id, client_id, deal_id, type, due_date, done, body, owner) values
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000004','follow_up', current_date,     false,'Call Khun Wachira re: proposal feedback.','b0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000005','call',      current_date - 2, false,'Overdue: confirm scope + budget with GreenLeaf.','b0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000006','meeting',   current_date + 3, false,'Discovery call for AI tutor add-on.','b0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',null,                                   'note',      null,             true, 'Sent thank-you note after kickoff.','b0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000007','follow_up', current_date + 5, false,'Send loyalty campaign one-pager.','b0000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- ── Projects (from won deals) ───────────────────────────────────────────────
insert into projects (id, org_id, deal_id, client_id, name, status, deadline, budget_satang, owner) values
  ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','LINE Sales-Support Bot — Doi Chang','in_progress', current_date + 12, 12000000,'b0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','CRM Automation — Krua Thai','not_started', current_date + 30, 16000000,'b0000000-0000-0000-0000-000000000003'),
  ('e0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000003','Course Onboarding — Lanna EdTech','support', current_date - 10, 10000000,'b0000000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001',null,'c0000000-0000-0000-0000-000000000005','Internal: Ops Automation Pilot','review', current_date + 5, 5000000,'b0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ── Project tasks ───────────────────────────────────────────────────────────
insert into project_tasks (org_id, project_id, title, status, assignee, due_date, done) values
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Design conversation flow','done','b0000000-0000-0000-0000-000000000002', current_date - 5, true),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Build LINE webhook + n8n flow','in_progress','b0000000-0000-0000-0000-000000000002', current_date + 3, false),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','UAT with Doi Chang staff','todo','b0000000-0000-0000-0000-000000000003', current_date + 9, false),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','Kickoff + requirements','todo','b0000000-0000-0000-0000-000000000003', current_date + 7, false),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','Monthly support check-in','todo','b0000000-0000-0000-0000-000000000002', current_date + 2, false)
on conflict do nothing;

-- ── Milestones / checklist ──────────────────────────────────────────────────
insert into milestones (org_id, project_id, title, done, due_date) values
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Phase 1: Flow approved', true,  current_date - 6),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Phase 2: Bot live in staging', false, current_date + 4),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Phase 3: Production handover', false, current_date + 12),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','Signed SOW', false, current_date + 6)
on conflict do nothing;

-- ── Finance: drafts (issued after their lines are complete) ─────────────────────────────────────
insert into invoices (id, org_id, client_id, project_id, number, status, issue_date, due_date, amount_satang, is_recurring, recurring_interval, notes) values
  ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','DRAFT-f0000000-0000-0000-0000-000000000001','draft',          current_date - 25, current_date - 10,  9000000, false, null,     'Deposit 50% — LINE bot project'),
  ('f0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002','DRAFT-f0000000-0000-0000-0000-000000000002','draft',          current_date - 8,  current_date + 7,  12500000, false, null,     'Deposit — CRM automation'),
  ('f0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004',null,                                   'DRAFT-f0000000-0000-0000-0000-000000000003','draft',       current_date - 30, current_date - 8,   5500000, false, null,     'Discovery workshop — Siam Property'),
  ('f0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000003','DRAFT-f0000000-0000-0000-0000-000000000004','draft',current_date - 15, current_date + 5,   8000000, false, null,     'Course onboarding — milestone 2'),
  ('f0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003',null,                                   'DRAFT-f0000000-0000-0000-0000-000000000005','draft',          current_date - 3,  current_date + 27,  3500000, true,  'monthly','Lanna EdTech — monthly support retainer'),
  ('f0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',null,                                   'DRAFT-f0000000-0000-0000-0000-000000000006','draft',         current_date,      current_date + 30,  4000000, true,  'monthly','Krua Thai — monthly automation retainer (draft)')
on conflict (id) do nothing;

-- ── Finance: payments ───────────────────────────────────────────────────────
insert into payments (org_id, invoice_id, amount_satang, paid_at, method, notes) values
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001', 9000000, date_trunc('month', now()) + interval '9 hours',  'transfer','Paid in full'),
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004', 4000000, now(),  'promptpay','Partial — 50%')
on conflict do nothing;

-- ── Finance: costs (this month + history) ───────────────────────────────────
insert into costs (org_id, project_id, category, amount_satang, incurred_on, vendor, notes) values
  ('a0000000-0000-0000-0000-000000000001',null,                                   'salary',     12000000, date_trunc('month', current_date)::date,        'Payroll','Junior dev salaries (2)'),
  ('a0000000-0000-0000-0000-000000000001',null,                                   'software',    1500000, current_date,                                   'OpenAI / Anthropic','LLM API usage'),
  ('a0000000-0000-0000-0000-000000000001',null,                                   'infra',        800000, current_date,                                   'Supabase / Vercel','Hosting'),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','contractor',  2500000, date_trunc('month', current_date)::date,        'Freelance designer','Bot UI/UX'),
  ('a0000000-0000-0000-0000-000000000001',null,                                   'marketing',   2000000, current_date,                                   'Meta Ads','Lead-gen campaign'),
  ('a0000000-0000-0000-0000-000000000001',null,                                   'salary',     12000000, (date_trunc('month', current_date) - interval '10 days')::date, 'Payroll','Junior dev salaries (last month)')
on conflict do nothing;

-- ── Templates: categories + automation templates ───────────────────────────
insert into template_categories (id, org_id, name, slug) values
  ('11110000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Sales & Support','sales-support'),
  ('11110000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','CRM & Follow-up','crm-followup'),
  ('11110000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','Education & Community','education')
on conflict (id) do nothing;

insert into automation_templates (org_id, category_id, name, description, internal_value_satang, price_satang, reusable_notes, implementation_checklist, tags) values
  ('a0000000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','LINE Sales-Support Bot','LINE OA bot that answers FAQs, captures leads, and routes to a human.', 18000000, 25000000, 'Reusable n8n + LINE Messaging API flow. Swap the FAQ knowledge base per client.', '["Connect LINE OA channel","Import n8n flow","Load FAQ knowledge base","Set human-handoff keyword","Test on staging"]'::jsonb, array['line','bot','sales','n8n']),
  ('a0000000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000002','n8n CRM Follow-up','Auto-creates follow-up tasks and reminders when a deal stage changes.', 12000000, 18000000, 'Webhook from CRM -> n8n -> LINE/email reminder. Map stages to cadences.', '["Expose deal webhook","Build n8n schedule","Configure reminder channel","Map stage -> cadence"]'::jsonb, array['crm','n8n','follow-up']),
  ('a0000000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000002','Invoice Overdue Reminder','Watches invoice due dates and nudges clients before/after due.', 9000000, 15000000, 'Cron + invoices table -> templated reminders at -3/0/+3/+7 days.', '["Connect invoice source","Set reminder schedule","Write message templates","Add escalation to owner"]'::jsonb, array['finance','invoice','reminder']),
  ('a0000000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','Meeting Summary Workflow','Transcribes a call and posts an AI summary + action items to LINE.', 8000000, 12000000, 'Whisper -> LLM summary -> LINE/Notion. Great upsell after a bot project.', '["Capture recording","Transcribe","Summarize + extract actions","Post to channel"]'::jsonb, array['ai','meeting','summary']),
  ('a0000000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000003','Course & Community Onboarding','Onboards new students: welcome, drip content, and community invite.', 15000000, 20000000, 'Payment webhook -> enrol -> drip sequence -> community auto-invite.', '["Hook payment provider","Build welcome sequence","Schedule drip content","Auto-invite to community"]'::jsonb, array['education','onboarding','community'])
on conflict do nothing;

-- ── V3: Quotations + line items ─────────────────────────────────────────────
insert into products (id, org_id, sku, name, description, type, unit, list_price_satang, cost_satang) values
  ('a5000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','CRM-BUILD','CRM automation build','CRM automation build (n8n + CRM)','service','project',15000000,9000000),
  ('a5000000-0000-4000-8000-000000000002','a0000000-0000-0000-0000-000000000001','TRAINING','Team training session','Team training session','service','day',1000000,500000),
  ('a5000000-0000-4000-8000-000000000003','a0000000-0000-0000-0000-000000000001','LINE-PHASE2','LINE bot phase 2 build','LINE bot — phase 2 build','service','project',8000000,4500000),
  ('a5000000-0000-4000-8000-000000000004','a0000000-0000-0000-0000-000000000001','DISCOVERY','Discovery and conversation design','Discovery & conversation-flow design','service','project',4000000,2000000),
  ('a5000000-0000-4000-8000-000000000005','a0000000-0000-0000-0000-000000000001','LINE-DEPOSIT','LINE bot build deposit','LINE bot build (50% deposit)','service','project',5000000,2500000),
  ('a5000000-0000-4000-8000-000000000006','a0000000-0000-0000-0000-000000000001','CRM-DEPOSIT','CRM automation deposit','CRM automation — deposit','service','project',12500000,8000000),
  ('a5000000-0000-4000-8000-000000000007','a0000000-0000-0000-0000-000000000001','RETAINER','Monthly automation retainer','Monthly automation retainer','service','month',4000000,2000000),
  ('a5000000-0000-4000-8000-000000000008','a0000000-0000-0000-0000-000000000001','CONSULTING','Automation consulting','Automation consulting','service','hour',350000,150000)
on conflict (id) do nothing;

insert into quotes (id, org_id, client_id, project_id, number, status, issue_date, valid_until, subtotal_satang, discount_satang, total_satang, notes, owner) values
  ('90000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002','QUO-2026-001','draft',    current_date - 4, current_date + 26, 17000000, 1000000, 16000000, 'CRM automation proposal — build + training', 'b0000000-0000-0000-0000-000000000001'),
  ('90000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','QUO-2026-002','draft',current_date - 9, current_date + 14,  8000000,       0,  8000000, 'LINE bot — phase 2 scope', 'b0000000-0000-0000-0000-000000000002')
on conflict (id) do nothing;

insert into quote_items (org_id, quote_id, description, quantity, unit_price_satang, amount_satang, position, product_id, unit) values
  ('a0000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','CRM automation build (n8n + CRM)', 1, 15000000, 15000000, 0, 'a5000000-0000-4000-8000-000000000001', 'project'),
  ('a0000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Team training session',            2,  1000000,  2000000, 1, 'a5000000-0000-4000-8000-000000000002', 'day'),
  ('a0000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002','LINE bot — phase 2 build',         1,  8000000,  8000000, 0, 'a5000000-0000-4000-8000-000000000003', 'project')
on conflict do nothing;
update quotes set status='sent' where id in ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002');
update quotes set status='accepted' where id='90000000-0000-0000-0000-000000000002';


-- ── V3: Invoice line items (sum to the invoice amount) ──────────────────────
with seed_lines(org_id,invoice_id,description,quantity,unit_price_satang,amount_satang,position,product_id,unit) as (values
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','Discovery & conversation-flow design', 1, 4000000, 4000000, 0, 'a5000000-0000-4000-8000-000000000004', 'project'),
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','LINE bot build (50% deposit)',         1, 5000000, 5000000, 1, 'a5000000-0000-4000-8000-000000000005', 'project'),
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','CRM automation — deposit',             1, 12500000, 12500000, 0, 'a5000000-0000-4000-8000-000000000006', 'project'),
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000003','Discovery workshop',1,5500000,5500000,0,null,'project'),
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','Course onboarding milestone 2',1,8000000,8000000,0,null,'project'),
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000005','Monthly support retainer',1,3500000,3500000,0,null,'month'),
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000006','Monthly automation retainer',1,4000000,4000000,0,null,'month')
)
insert into public.invoice_items(org_id,invoice_id,description,quantity,unit_price_satang,amount_satang,position,product_id,unit)
select l.org_id::uuid,l.invoice_id::uuid,l.description,l.quantity,l.unit_price_satang,l.amount_satang,l.position,l.product_id::uuid,l.unit
from seed_lines l join public.invoices i on i.org_id=l.org_id::uuid and i.id=l.invoice_id::uuid
where i.status='draft' and i.issued_snapshot_id is null and not exists(
  select 1 from public.invoice_items item where item.org_id=i.org_id and item.invoice_id=i.id and item.position=l.position
);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b0000000-0000-0000-0000-000000000001"}',false);
do $$
declare i public.invoices;
begin
  if (select legal_name is null from public.org_settings where org_id='a0000000-0000-0000-0000-000000000001') then
    perform public.update_business_profile('a0000000-0000-0000-0000-000000000001','Synthetic BoomBigNose seller','Synthetic Bangkok address',null,'not_registered');
  end if;
  for i in select * from public.invoices where org_id='a0000000-0000-0000-0000-000000000001' and id in (
    'f0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000003',
    'f0000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-000000000005') and status='draft' and issued_snapshot_id is null order by id
  loop
    perform public.issue_invoice(i.org_id,i.id,i.version,i.id);
  end loop;
end;
$$;
select set_config('request.jwt.claims','{}',false);

-- ── V3: Timesheets ──────────────────────────────────────────────────────────
insert into time_entries (org_id, project_id, task_id, user_id, work_date, minutes, billable, rate_satang, notes) values
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',null,'b0000000-0000-0000-0000-000000000002', current_date - 5, 240, true, 100000, 'Conversation flow design'),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',null,'b0000000-0000-0000-0000-000000000002', current_date - 3, 180, true, 100000, 'n8n webhook wiring'),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',null,'b0000000-0000-0000-0000-000000000003', current_date - 1, 300, true,  80000, 'LINE integration + tests'),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003',null,'b0000000-0000-0000-0000-000000000002', current_date - 2, 120, false,   null, 'Monthly support check-in (non-billable)')
on conflict do nothing;

-- ── V3: Subscriptions (recurring billing → feeds MRR) ───────────────────────
insert into subscriptions (id, org_id, client_id, project_id, name, amount_satang, interval, status, start_date, next_run_date, last_generated_on, auto_generate, notes) values
  ('80000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000003','Lanna EdTech — monthly support', 3500000, 'monthly','active', date_trunc('month', current_date)::date, current_date + 27, date_trunc('month', current_date)::date, true, 'Monthly support retainer'),
  ('80000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',null,                                   'Krua Thai — automation retainer', 4000000, 'monthly','active', current_date, current_date + 30, null, true, 'Monthly automation retainer')
on conflict (id) do nothing;

insert into public.vendors(id,org_id,name,email,payment_terms_days,notes) values
  ('a6000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','Demo Cloud Supply','cloud-supply@example.invalid',30,'Synthetic demo vendor'),
  ('a6000000-0000-4000-8000-000000000002','a0000000-0000-0000-0000-000000000001','Demo Studio Partners','studio-partners@example.invalid',14,'Synthetic demo vendor')
on conflict(id) do nothing;
insert into public.purchase_orders(id,org_id,number,vendor_id,status,order_date,expected_date,created_by) values
  ('a7000000-0000-4000-8000-000000000001','a0000000-0000-0000-0000-000000000001','PO-'||extract(year from current_date)::text||'-001','a6000000-0000-4000-8000-000000000001','received',current_date-5,current_date-1,'b0000000-0000-0000-0000-000000000001'),
  ('a7000000-0000-4000-8000-000000000002','a0000000-0000-0000-0000-000000000001','PO-'||extract(year from current_date)::text||'-002','a6000000-0000-4000-8000-000000000002','draft',current_date,current_date+7,'b0000000-0000-0000-0000-000000000001')
on conflict(id) do nothing;
insert into public.purchase_order_items(id,org_id,purchase_order_id,product_id,description,quantity,unit,unit_cost_satang,received_quantity,position)
select v.id,'a0000000-0000-0000-0000-000000000001',v.po,p.id,coalesce(p.description,p.name),v.qty,p.unit,p.cost_satang,v.received,0
from (values
  ('a7100000-0000-4000-8000-000000000001'::uuid,'a7000000-0000-4000-8000-000000000001'::uuid,'a5000000-0000-4000-8000-000000000001'::uuid,2,2),
  ('a7100000-0000-4000-8000-000000000002'::uuid,'a7000000-0000-4000-8000-000000000002'::uuid,'a5000000-0000-4000-8000-000000000002'::uuid,1,0)
) v(id,po,product,qty,received)
join public.products p on p.id=v.product and p.org_id='a0000000-0000-0000-0000-000000000001'
on conflict(id) do nothing;
insert into public.document_counters(org_id,kind,year,value)
values('a0000000-0000-0000-0000-000000000001','PO',extract(year from current_date)::integer,2)
on conflict(org_id,kind,year) do update set value=greatest(document_counters.value,excluded.value);

-- One submitted expense claim from the first seeded member, waiting on the owner.
insert into public.expense_claims(id,org_id,number,employee,title,status,submitted_at)
select 'a8000000-0000-4000-8000-000000000001',m.org_id,'EXP-'||extract(year from current_date)::text||'-001',m.user_id,'Client workshop travel','submitted',now()
from public.memberships m
where m.org_id=(select org_id from public.vendors where id='a6000000-0000-4000-8000-000000000001') and m.role='member'
order by m.user_id limit 1
on conflict(id) do nothing;
insert into public.expense_lines(id,org_id,claim_id,spent_on,category,description,amount_satang,project_id,position)
select v.id,c.org_id,c.id,current_date-2,'other',v.description,v.amount,
  case when v.rebill then (select p.id from public.projects p where p.org_id=c.org_id order by p.created_at,p.id limit 1) end,v.position
from public.expense_claims c,
  (values ('a8100000-0000-4000-8000-000000000001'::uuid,'Taxi to client workshop',35000,true,0),
          ('a8100000-0000-4000-8000-000000000002'::uuid,'Workshop lunch',84000,false,1)) v(id,description,amount,rebill,position)
where c.id='a8000000-0000-4000-8000-000000000001'
on conflict(id) do nothing;
insert into public.activities(org_id,record_type,record_id,owner,type,due_date,body)
select c.org_id,'expense_claim',c.id,m.user_id,'follow_up',current_date,'Review expense claim '||c.number
from public.expense_claims c join public.memberships m on m.org_id=c.org_id and m.role in ('owner','admin') and m.user_id<>c.employee
where c.id='a8000000-0000-4000-8000-000000000001'
  and not exists(select 1 from public.activities a where a.record_type='expense_claim' and a.record_id=c.id);
insert into public.document_counters(org_id,kind,year,value)
select org_id,'EXP',extract(year from current_date)::integer,1 from public.expense_claims where id='a8000000-0000-4000-8000-000000000001'
on conflict(org_id,kind,year) do update set value=greatest(document_counters.value,excluded.value);
