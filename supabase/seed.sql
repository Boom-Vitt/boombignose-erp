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

-- ── Finance: invoices (varied statuses) ─────────────────────────────────────
insert into invoices (id, org_id, client_id, project_id, number, status, issue_date, due_date, amount_satang, is_recurring, recurring_interval, notes) values
  ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','INV-2026-001','paid',          current_date - 25, current_date - 10,  9000000, false, null,     'Deposit 50% — LINE bot project'),
  ('f0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000002','INV-2026-002','sent',          current_date - 8,  current_date + 7,  12500000, false, null,     'Deposit — CRM automation'),
  ('f0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004',null,                                   'INV-2026-003','overdue',       current_date - 30, current_date - 8,   5500000, false, null,     'Discovery workshop — Siam Property'),
  ('f0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000003','INV-2026-004','partially_paid',current_date - 15, current_date + 5,   8000000, false, null,     'Course onboarding — milestone 2'),
  ('f0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000003',null,                                   'INV-2026-005','sent',          current_date - 3,  current_date + 27,  3500000, true,  'monthly','Lanna EdTech — monthly support retainer'),
  ('f0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',null,                                   'INV-2026-006','draft',         current_date,      current_date + 30,  4000000, true,  'monthly','Krua Thai — monthly automation retainer (draft)')
on conflict (id) do nothing;

-- ── Finance: payments ───────────────────────────────────────────────────────
insert into payments (org_id, invoice_id, amount_satang, paid_at, method, notes) values
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001', 9000000, now() - interval '9 days',  'transfer','Paid in full'),
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004', 4000000, now() - interval '2 days',  'promptpay','Partial — 50%')
on conflict do nothing;

-- ── Finance: costs (this month + history) ───────────────────────────────────
insert into costs (org_id, project_id, category, amount_satang, incurred_on, vendor, notes) values
  ('a0000000-0000-0000-0000-000000000001',null,                                   'salary',     12000000, current_date - 1,  'Payroll','Junior dev salaries (2)'),
  ('a0000000-0000-0000-0000-000000000001',null,                                   'software',    1500000, current_date - 4,  'OpenAI / Anthropic','LLM API usage'),
  ('a0000000-0000-0000-0000-000000000001',null,                                   'infra',        800000, current_date - 6,  'Supabase / Vercel','Hosting'),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','contractor',  2500000, current_date - 9,  'Freelance designer','Bot UI/UX'),
  ('a0000000-0000-0000-0000-000000000001',null,                                   'marketing',   2000000, current_date - 12, 'Meta Ads','Lead-gen campaign'),
  ('a0000000-0000-0000-0000-000000000001',null,                                   'salary',     12000000, current_date - 32, 'Payroll','Junior dev salaries (last month)')
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
