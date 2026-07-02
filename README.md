<div align="center">

# 🐘 BoomBigNose Company OS

### ระบบปฏิบัติการธุรกิจ (Company OS) สำหรับสตูดิโอสาย AI — CRM · ดีล · โปรเจกต์ · การเงิน · ระบบอัตโนมัติ · แดชบอร์ดผู้ก่อตั้ง

*"ชั้นปฏิบัติการ" ของการทำธุรกิจ — ไม่ใช่ระบบบัญชี/ภาษี แต่เป็นที่เดียวที่มองเห็นและสั่งงานทั้งบริษัทได้จริง*

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
<br/>
[![Tests](https://img.shields.io/badge/tests-125%20passing-brightgreen)](#-คำสั่งที่ใช้บ่อย-scripts)
[![Status](https://img.shields.io/badge/status-internal%20MVP-blue)](#-สถานะโปรเจกต์)
[![License](https://img.shields.io/badge/license-proprietary%20·%20open--core%20planned-orange)](./LICENSE.md)
![Made in Thailand](https://img.shields.io/badge/made%20in-Bangkok%20🇹🇭-ED1C24)

<br/>

[**โรดแมป**](#-โรดแมป-roadmap) · [**เอกสาร**](./docs) · [**รายงานบั๊ก**](https://github.com/Boom-Vitt/boombignose-erp/issues) · [**ขอฟีเจอร์**](https://github.com/Boom-Vitt/boombignose-erp/issues/new)

</div>

<!-- แนะนำ: ใส่ภาพหน้าจอแดชบอร์ดตรงนี้ (เช่น docs/cover.png) เพื่อให้หน้า repo ดูสมบูรณ์ -->

> [!NOTE]
> BoomBigNose Company OS คือ **"ระบบปฏิบัติการของบริษัท"** ไม่ใช่ระบบบัญชี/ใบกำกับภาษีตามกฎหมาย
> เรื่องบัญชียังคงอยู่กับ **FlowAccount / PEAK / Xero** (จะเชื่อมต่อในภายหลัง) — โปรดักต์นี้คือ *ชั้นปฏิบัติการ* ไม่ใช่ *สมุดบัญชีหลัก*

---

## 📑 สารบัญ

- [เกี่ยวกับโปรเจกต์](#-เกี่ยวกับโปรเจกต์-about)
- [ฟีเจอร์](#-ฟีเจอร์-features)
- [เทคโนโลยีที่ใช้](#-เทคโนโลยีที่ใช้-built-with)
- [เริ่มต้นใช้งาน](#-เริ่มต้นใช้งาน-getting-started)
- [ตัวแปรสภาพแวดล้อม](#-ตัวแปรสภาพแวดล้อม-environment)
- [คำสั่งที่ใช้บ่อย](#-คำสั่งที่ใช้บ่อย-scripts)
- [โครงสร้างโปรเจกต์](#-โครงสร้างโปรเจกต์-project-structure)
- [สถาปัตยกรรม](#-สถาปัตยกรรม-architecture)
- [โรดแมป](#-โรดแมป-roadmap)
- [โมเดล Open-core](#-โมเดล-open-core)
- [การมีส่วนร่วม](#-การมีส่วนร่วม-contributing)
- [ความปลอดภัยและ PDPA](#-ความปลอดภัยและ-pdpa)
- [สัญญาอนุญาต](#-สัญญาอนุญาต-license)

---

## 🎯 เกี่ยวกับโปรเจกต์ (About)

BoomBigNose Company OS เป็น **Company OS / ERP แบบเบา ที่ออกแบบมาแนว AI-native** สำหรับสตูดิโอสาย AI education + workflow automation ในไทย (ผู้ก่อตั้ง + ทีมเล็ก) ให้ทุกอย่างของธุรกิจอยู่ในที่เดียว: ลูกค้าและดีล, การส่งมอบโปรเจกต์, เงินเข้า–ออก, คลังเทมเพลตระบบอัตโนมัติที่นำกลับมาใช้ซ้ำได้ และแดชบอร์ดที่แสดง เงินสด / burn / รายได้ / pipeline / runway

ออกแบบให้ **ใช้ภายในบริษัทก่อน (dogfooding)** แต่วางรากฐานให้สะอาด (`org_id` ทุกตาราง, ขอบเขตโมดูลชัดเจน) เพื่อให้ต่อยอดเป็นสินค้า **open-core (Community + Pro)** ได้โดยไม่ต้องเขียนใหม่

**สร้างมาเพื่อใคร**
- 👑 **ผู้ก่อตั้ง–ผู้บริหาร** (หลัก): แดชบอร์ดเดียวเห็นทั้ง pipeline, การส่งมอบงาน และกระแสเงินสด
- 🛠️ **จูเนียร์เดฟ**: หน้า "งานของฉัน" + ยิงเทมเพลตอัตโนมัติที่นำกลับมาใช้ซ้ำได้

---

## ✨ ฟีเจอร์ (Features)

### หลัก (V1 — ใช้งานได้แล้ว)

- 📊 **แดชบอร์ด** — เงินสด, burn รายเดือน, รายได้เดือนนี้, ใบแจ้งหนี้ค้างชำระ, MRR, มูลค่า pipeline, โปรเจกต์ที่กำลังทำ, **runway**, งานติดตามวันนี้ และรายการที่เกินกำหนด
- 👥 **CRM** — ลูกค้า, ผู้ติดต่อ, ดีล (บอร์ด pipeline), กิจกรรม/การติดตาม
- 📁 **โปรเจกต์** — บอร์ดส่งมอบงาน, งานย่อย (tasks), milestones และสร้างโปรเจกต์จากดีลที่ปิดได้ (won)
- 💰 **การเงิน** — ใบแจ้งหนี้, การชำระเงิน, ต้นทุน, กำไรขั้นต้น, MRR *(เชิงปฏิบัติการ ไม่ใช่บัญชีตามกฎหมาย)*
- 🧩 **เทมเพลต** — คลังเทมเพลต/เวิร์กโฟลว์อัตโนมัติ พร้อมเช็กลิสต์และราคา
- 🔗 **Webhook อัตโนมัติ** — endpoint ขาเข้าจาก n8n ที่ตรวจ `X-Webhook-Secret`
- 🔐 **Auth & สิทธิ์** — Supabase Auth; บทบาท owner / admin / member; single-org (พร้อมโครงสร้าง multi-tenant)

### ใหม่ใน V2 🆕 *(อยู่บนเบรนช์ [`feat/company-os-v2`](https://github.com/Boom-Vitt/boombignose-erp/tree/feat/company-os-v2))*

- 📝 **Audit log + ประวัติกิจกรรม** — บันทึกการเปลี่ยนแปลงสำคัญทุกอย่าง เห็นได้ที่หน้า `/audit` (จำกัดเฉพาะ owner/admin)
- 📤 **รายงาน & Export CSV** — ใบแจ้งหนี้ / ต้นทุน / ดีล (เป็นบาท, ป้องกัน CSV formula injection) + **saved views** + ตัวกรองผ่าน URL
- 🤖 **ผู้ช่วย AI** — สรุปดีล, ร่างข้อความติดตาม, และ **สรุปโน้ตประชุม** ที่ `/intake` *(degrade อย่างสวยงาม: ถ้าไม่ตั้ง `ANTHROPIC_API_KEY` จะขึ้นข้อความ "ยังไม่ได้ตั้งค่า" โดยไม่ล่ม — ใส่คีย์เมื่อไรก็ทำงานจริงทันที)*
- ⏰ **ระบบติดตามอัตโนมัติ** — `/api/cron/followups` สแกนงานที่ถึงกำหนด → สร้าง `reminders` + คิว `outbound_events` (ให้ n8n/Hermes ไปส่ง LINE ต่อ)
- 🧾 **โครงเชื่อมต่อระบบบัญชี** — เชื่อม FlowAccount/PEAK/Xero + ปุ่ม "Sync to accounting" บนใบแจ้งหนี้ *(การ push จริงเป็น stub ที่มี seam ชัดเจน — mapping และ record จริง; ไม่มี engine ออกใบกำกับภาษี ตามขอบเขตที่วางไว้)*
- ✉️ **ทำ auth ให้พร้อมใช้จริง** — สมัครสมาชิก `/signup` + ยืนยันอีเมล + นโยบายรหัสผ่าน

> [!TIP]
> ขอบเขตที่ **ตั้งใจไม่ทำ** (กัน scope creep เป็น ERP): ไม่มีสต็อก, จัดซื้อ, เครื่องคิดเงินเดือน หรือการออกใบกำกับภาษี — เรื่องบัญชียกให้ FlowAccount/PEAK/Xero

---

## 🧱 เทคโนโลยีที่ใช้ (Built With)

| ด้าน | เทคโนโลยี |
|---|---|
| Framework | **Next.js 16** (App Router, Server Actions) · **TypeScript** |
| UI | **Tailwind CSS v4** · **shadcn/ui** (Base UI) · lucide-react · sonner |
| Backend / DB | **Supabase** — Postgres + Auth + **Row Level Security** |
| Validation / Forms | **Zod v4** · React Hook Form |
| AI | **@anthropic-ai/sdk** (Claude — เปิดใช้เมื่อมีคีย์) |
| ทดสอบ | **Vitest** (unit) · **Playwright** (e2e) |
| Tooling | pnpm · ESLint · date-fns · TanStack Table |

---

## 🚀 เริ่มต้นใช้งาน (Getting Started)

### สิ่งที่ต้องมี

- **Node.js 20+**
- **pnpm**
- **Docker** (สำหรับรัน Supabase บนเครื่อง)
- **Supabase CLI**

### ติดตั้งและรัน (โลคัล)

```bash
# 1) โคลนโปรเจกต์
git clone https://github.com/Boom-Vitt/boombignose-erp.git
cd boombignose-erp

# 2) ติดตั้ง dependencies
pnpm install

# 3) สตาร์ท Supabase บนเครื่อง (Postgres + Auth + API) — ต้องเปิด Docker ไว้
supabase start

# 4) รันไมเกรชัน + โหลดข้อมูลเดโม (SME ไทยจำลอง)
supabase db reset

# 5) สร้างไฟล์ env จากตัวอย่าง แล้วเติมค่าคีย์
cp .env.example .env.local
supabase status          # คัดลอก URL + anon/service_role key มาใส่ .env.local

# 6) (ทางเลือก) พิสูจน์ว่า seed + RLS ทำงานถูกต้อง
set -a; source .env.local; set +a
node scripts/verify-seed.mjs

# 7) รันแอป
pnpm dev                 # http://localhost:3000
```

### เข้าสู่ระบบด้วยบัญชีเดโม

| อีเมล | รหัสผ่าน | บทบาท |
|---|---|---|
| `demo@boombignose.org` | `BoomDemo123!` | owner |
| `nattapong@boombignose.org` | `BoomDemo123!` | member |
| `praewa@boombignose.org` | `BoomDemo123!` | member |

> หน้า login มีปุ่ม **"Use demo account"** กดครั้งเดียวเข้าได้เลย

---

## 🔑 ตัวแปรสภาพแวดล้อม (Environment)

คัดลอกจาก [`.env.example`](./.env.example) ไปเป็น `.env.local` (ห้าม commit `.env.local`)

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|:---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | URL ของ Supabase (โลคัลได้จาก `supabase status`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon key (ฝั่ง client ปลอดภัย) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | service-role key — **ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น** (seed + cron) ห้ามใส่ใน client |
| `N8N_WEBHOOK_SECRET` | ✅ | secret สำหรับ webhook ขาเข้าจาก n8n (`X-Webhook-Secret`) |
| `CRON_SECRET` | ✅ | secret สำหรับ endpoint สแกนงานติดตาม (`X-Cron-Secret`) |
| `NEXT_PUBLIC_APP_URL` | ✅ | URL ของแอป (ใช้ทำลิงก์/redirect ตอนยืนยันอีเมล) |
| `ANTHROPIC_API_KEY` | ⬜ | เปิดใช้ผู้ช่วย AI — ถ้าไม่ใส่ ฟีเจอร์ AI จะ degrade อย่างสวยงาม |
| `ANTHROPIC_MODEL` | ⬜ | override โมเดล (ดีฟอลต์ `claude-opus-4-8`) |

---

## 🧰 คำสั่งที่ใช้บ่อย (Scripts)

```bash
pnpm dev            # dev server
pnpm build          # production build
pnpm test           # unit tests (Vitest) — ไม่ต้องมีฐานข้อมูล
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm e2e            # Playwright smoke tests (ต้องรันแอปอยู่)
```

---

## 🗂️ โครงสร้างโปรเจกต์ (Project structure)

```
app/
  (app)/              พื้นที่ล็อกอิน (แดชบอร์ด + โมดูล) ใช้ layout/sidebar ร่วมกัน
    dashboard/  clients/  deals/  projects/  finance/  templates/
    settings/  audit/  automation/  intake/          # audit/automation/intake = V2
  api/webhooks/n8n/   endpoint อัตโนมัติขาเข้า (X-Webhook-Secret)
  api/cron/followups/ สแกนงานติดตาม → reminders + outbound_events (V2)
  login/  signup/  auth/confirm/  auth/signout/
components/           app-sidebar, nav registry, UI ที่ใช้ร่วม (page-header, stat-card, ...)
  ui/                 shadcn (Base UI) primitives
lib/
  supabase/           client ฝั่ง server / browser / middleware / admin
  metrics/            business logic แบบ PURE ที่ unit-test ครบ (finance, pipeline, projects, ...)
  ai/  accounting/    ผู้ช่วย AI + โครง sync บัญชี (V2)
  money.ts  dates.ts  auth.ts  audit.ts  export/  automation/
supabase/
  migrations/         schema + RLS
  seed.sql            ข้อมูลเดโม SME ไทยจำลอง
docs/                 MVP_SPEC, ROADMAP, OPEN_CORE_STRATEGY, PDPA_SECURITY_NOTES, N8N_INTEGRATION, ...
```

---

## 🏛️ สถาปัตยกรรม (Architecture)

- 💵 **เงินเก็บเป็นสตางค์จำนวนเต็ม (`bigint` satang)** ทุกที่ ไม่ใช้ float — ฟอร์แมตด้วย `formatTHB()` ที่ขอบเท่านั้น เลขการเงินจึงเป๊ะและเทสต์ได้
- 🛡️ **แยกข้อมูลด้วย RLS เป็นหลัก** — ทุกตารางมี `org_id` และ policy ที่ `force` ผ่าน `private.is_org_member()`; service-role key ใช้เฉพาะ seed/cron ไม่เคยอยู่ใน request path หรือ bundle ฝั่ง client
- 🧪 **Business logic แบบ pure** อยู่ใน `lib/` และ unit-test ครบ ทำให้ `pnpm test` ไม่ต้องพึ่งฐานข้อมูล
- ⚙️ **Server Actions** จัดการ mutation ทั้งหมด (ตรวจด้วย Zod, scope ตาม org); **Server Components** จัดการการอ่าน
- 🌏 สกุลเงิน **THB** และเขตเวลา **Asia/Bangkok** สำหรับคำว่า "วันนี้/เดือนนี้"

---

## 🗺️ โรดแมป (Roadmap)

- [x] **V1 — MVP ภายใน**: auth + org เดียว, แดชบอร์ด, CRM, โปรเจกต์, การเงิน, คลังเทมเพลต, webhook n8n
- [x] **V2 — คมขึ้น**: audit log, export/รายงาน + saved views, ผู้ช่วย AI, ระบบติดตามอัตโนมัติ, โครง sync บัญชี, ทำ auth ให้พร้อมใช้จริง
- [ ] **V3 — ทำเป็นสินค้า (open-core)**: multi-org UX จริง (org switcher, คำเชิญ), self-host + deploy คำสั่งเดียว, Community Edition (AGPL), **Pro tier** (SaaS โฮสต์, SSO, RBAC ขั้นสูง, client portal, automation packs, white-label)

ดูรายละเอียดเต็มที่ [`docs/ROADMAP.md`](./docs/ROADMAP.md)

---

## 🧩 โมเดล Open-core

โปรเจกต์วางไว้ให้เป็น **open-core**: แกนหลัก (Community) + ฟีเจอร์ระดับองค์กร (Pro) แนวทางที่แนะนำคือ **dual license: AGPLv3 หรือ Commercial** — อ่านการเทียบและเส้นแบ่ง Community vs Pro ได้ที่ [`docs/OPEN_CORE_STRATEGY.md`](./docs/OPEN_CORE_STRATEGY.md)

---

## 🤝 การมีส่วนร่วม (Contributing)

ยินดีรับ issue และข้อเสนอแนะ! เนื่องจาก **ยังไม่ได้เลือกสัญญาอนุญาตอย่างเป็นทางการ** (ดูด้านล่าง) เราจะเปิดรับ pull request จากภายนอกหลังจากตั้งค่าไลเซนส์ + CLA เรียบร้อยแล้ว ระหว่างนี้:

1. เปิด [issue](https://github.com/Boom-Vitt/boombignose-erp/issues) เพื่อคุยเรื่องบั๊กหรือฟีเจอร์ก่อน
2. ให้ `pnpm lint && pnpm typecheck && pnpm test && pnpm build` ผ่านทั้งหมด
3. เขียนโค้ดให้เข้ากับสไตล์เดิม และคง business logic ที่ต้องเทสต์ให้อยู่ใน `lib/` แบบ pure

---

## 🔐 ความปลอดภัยและ PDPA

- ยัง **เป็นข้อมูลเดโมเท่านั้น** — **อย่าใส่ข้อมูลลูกค้าจริง** จนกว่าจะจัดการเรื่องใน [`docs/PDPA_SECURITY_NOTES.md`](./docs/PDPA_SECURITY_NOTES.md) ครบ (รวมถึงเรื่อง data region / การส่งข้อมูลข้ามพรมแดน)
- ห้าม commit `.env.local` หรือ secret ใด ๆ — ไฟล์ที่ track มีแค่ `.env.example` (เป็น placeholder)
- พบช่องโหว่ด้านความปลอดภัย? กรุณาแจ้งแบบส่วนตัวถึงผู้ดูแล อย่าเปิดเป็น issue สาธารณะ

---

## 📄 สัญญาอนุญาต (License)

> [!IMPORTANT]
> **ยังไม่ได้เลือกสัญญาอนุญาต** — ปัจจุบันซอฟต์แวร์นี้เป็น **proprietary / สงวนสิทธิ์ทั้งหมด** สำหรับใช้ภายในเท่านั้น ยังไม่อนุญาตให้เผยแพร่ต่อ

ทิศทางที่วางไว้คือ open-core แบบ **dual license (AGPLv3 หรือ Commercial)** — รายละเอียดที่ [`LICENSE.md`](./LICENSE.md) และ [`docs/OPEN_CORE_STRATEGY.md`](./docs/OPEN_CORE_STRATEGY.md)

Copyright © 2026 BoomBigNose AI Co., Ltd.

<div align="center">
<br/>
สร้างด้วย ❤️ ที่กรุงเทพฯ — โดยทีม <b>BoomBigNose</b>
</div>
