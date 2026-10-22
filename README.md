<!-- BBN:HEADER:START -->
<img src=".github/brand/banner.svg" width="100%" alt="BoomBigNose ERP · Open-source Company OS (AGPL-3.0) for AI-era teams" />
<!-- BBN:HEADER:END -->

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
[![Tests](https://img.shields.io/badge/tests-510%20passing-brightgreen)](#-คำสั่งที่ใช้บ่อย-scripts)
[![Status](https://img.shields.io/badge/status-open--core-blue)](#license)
[![License](https://img.shields.io/badge/license-AGPL--3.0%20%7C%20Commercial-blue)](./COMMERCIAL-LICENSE.md)
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
- [License / สัญญาอนุญาต](#license)

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

### ใหม่ใน V2 🆕 *(รวมเข้า `main` แล้ว)*

- 📝 **Audit log + ประวัติกิจกรรม** — บันทึกการเปลี่ยนแปลงสำคัญทุกอย่าง เห็นได้ที่หน้า `/audit` (จำกัดเฉพาะ owner/admin)
- 📤 **รายงาน & Export CSV** — ใบแจ้งหนี้ / ต้นทุน / ดีล (เป็นบาท, ป้องกัน CSV formula injection) + **saved views** + ตัวกรองผ่าน URL
- 🤖 **ผู้ช่วย AI** — สรุปดีล, ร่างข้อความติดตาม, และ **สรุปโน้ตประชุม** ที่ `/intake` *(degrade อย่างสวยงาม: ใช้ Gemini 4 ผ่าน OpenRouter — ถ้าไม่ตั้ง `OPENROUTER_API_KEY` จะขึ้นข้อความ "ยังไม่ได้ตั้งค่า" โดยไม่ล่ม — ใส่คีย์เมื่อไรก็ทำงานจริงทันที)*
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
| AI | **Gemini 4 ผ่าน OpenRouter** (`fetch` ตรง ๆ — เปิดใช้เมื่อมีคีย์) |
| ทดสอบ | **Vitest** (unit) · **Playwright** (e2e) |
| Tooling | pnpm · ESLint · date-fns · TanStack Table |

---

## 🚀 เริ่มต้นใช้งาน (Getting Started)

### สิ่งที่ต้องมี

- **Node.js 22+**
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

สำหรับ Community ที่ต้องการสร้างองค์กรใหม่ ให้เริ่มจากฐานข้อมูลว่างโดยไม่โหลด demo seed (`supabase db reset --no-seed` สำหรับฐานข้อมูล local ใหม่) จากนั้นสมัครที่ `/signup` ยืนยันบัญชี สร้างองค์กรที่ `/onboarding` และเชิญทีมจาก Settings โดยไม่ต้องมี `ee/` การโหลด demo seed จะสร้างองค์กรเดโมไว้แล้ว

### เข้าสู่ระบบด้วยบัญชีเดโม

| อีเมล | รหัสผ่าน | บทบาท |
|---|---|---|
| `demo@boombignose.org` | `BoomDemo123!` | owner |
| `nattapong@boombignose.org` | `BoomDemo123!` | member |
| `praewa@boombignose.org` | `BoomDemo123!` | member |

> ปุ่ม **"Use demo account"** ในหน้า login ปิดไว้เป็นค่าเริ่มต้น ถ้าต้องการตอน dev ให้ตั้ง `NEXT_PUBLIC_DEMO_LOGIN_EMAIL` และ `NEXT_PUBLIC_DEMO_LOGIN_PASSWORD` ใน `.env.local` (ห้ามตั้งบน production)
>
> สมัครบัญชีใหม่ต้องยืนยันอีเมลก่อนเข้าระบบ: local stack ส่งอีเมลยืนยันไปที่ Inbucket (`http://127.0.0.1:54424` หรือพอร์ต `[inbucket]` ของ lane นั้น)

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
| `OPENROUTER_API_KEY` | ⬜ | เปิดใช้ผู้ช่วย AI (Gemini 4 ผ่าน OpenRouter) — ถ้าไม่ใส่ ฟีเจอร์ AI จะ degrade อย่างสวยงาม |
| `OPENROUTER_MODEL` | ⬜ | override โมเดล (ดีฟอลต์ `google/gemini-4-argon`) |
| `BBN_EDITION` | ⬜ | เลือกตอน build: `community` เป็นค่าเริ่มต้น, `pro` สำหรับ Pro ที่มีข้อตกลงเชิงพาณิชย์ |

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
  ai/                 ผู้ช่วย AI พื้นฐาน (Community)
  money.ts  dates.ts  auth.ts  audit.ts  export/  automation/
ee/                   Pro: client portal, accounting sync, multi-org UX (commercial)
bignose/              BigNose OS แยกผลิตภัณฑ์ (proprietary/commercial)
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

โปรเจกต์เป็น **open-core**: Community Edition ใช้ **AGPL-3.0-only หรือ Commercial** ส่วน Pro แยกไว้ใน `ee/` ภายใต้สัญญาอนุญาตเชิงพาณิชย์ ดูเส้นแบ่งที่ [`docs/OPEN_CORE_BOUNDARY.md`](./docs/OPEN_CORE_BOUNDARY.md) และแนวทางที่ [`docs/OPEN_CORE_STRATEGY.md`](./docs/OPEN_CORE_STRATEGY.md)

---

## 🤝 การมีส่วนร่วม (Contributing)

ยินดีรับ issue และ pull request! อ่าน [`CONTRIBUTING.md`](./CONTRIBUTING.md) และยอมรับ [`CLA.md`](./CLA.md) พร้อมติ๊กช่องยืนยันใน PR ก่อนส่งผลงาน โดยผู้ร่วมพัฒนายังคงเป็นเจ้าของผลงาน และอนุญาตให้ BoomBigNose AI Co., Ltd. ออกสัญญาอนุญาตทั้งแบบโอเพนซอร์สและเชิงพาณิชย์ได้

ให้ `pnpm lint`, `pnpm typecheck`, `pnpm test` และ `pnpm build` ผ่านก่อนส่ง PR และคงขอบเขต Community / Pro ตามเอกสาร

---

## 🔐 ความปลอดภัยและ PDPA

- ยัง **เป็นข้อมูลเดโมเท่านั้น** — **อย่าใส่ข้อมูลลูกค้าจริง** จนกว่าจะจัดการเรื่องใน [`docs/PDPA_SECURITY_NOTES.md`](./docs/PDPA_SECURITY_NOTES.md) ครบ (รวมถึงเรื่อง data region / การส่งข้อมูลข้ามพรมแดน)
- ห้าม commit `.env.local` หรือ secret ใด ๆ — ไฟล์ที่ track มีแค่ `.env.example` (เป็น placeholder)
- พบช่องโหว่ด้านความปลอดภัย? กรุณาแจ้งแบบส่วนตัวถึงผู้ดูแล อย่าเปิดเป็น issue สาธารณะ

---

<a id="license"></a>

## 📄 License / สัญญาอนุญาต

**ไทย:** Community รองรับการสมัคร สร้างองค์กรแรก และเชิญ/รับสมาชิกในองค์กรเดียวด้วยบทบาท owner/admin/member โดยไม่ต้องใช้ `ee/` ส่วนการสลับหลายองค์กรและการ provision องค์กรเพิ่มเติมสำหรับ hosted อยู่ใน Pro เท่านั้น Community Edition ใช้ [AGPL-3.0-only](./LICENSE) หรือ [Commercial license](./COMMERCIAL-LICENSE.md) ตามข้อตกลงกับบริษัท ใช้งานเชิงพาณิชย์ภายใต้ AGPL ได้เมื่อปฏิบัติตามเงื่อนไข รวมถึงการให้ซอร์สตามข้อกำหนด Pro ใน [`ee/`](./ee/) ใช้ [สัญญาอนุญาตเชิงพาณิชย์](./ee/LICENSE) แยกต่างหาก และต้องมีข้อตกลงก่อนใช้ใน production ส่วน [`bignose/`](./bignose/LICENSE) เป็น BigNose OS แยกผลิตภัณฑ์และไม่อยู่ใต้ AGPL

**English:** Community includes signup, first-org setup, and team invitations/acceptance with owner/admin/member roles, without `ee/`. Multi-org switching and additional or hosted workspace provisioning are Pro. Community Edition is dual-licensed under [AGPL-3.0-only](./LICENSE) or a separately agreed [Commercial license](./COMMERCIAL-LICENSE.md). Pro implementations in [`ee/`](./ee/) are commercial source-available software under [`ee/LICENSE`](./ee/LICENSE); production use requires a commercial agreement. [`bignose/`](./bignose/LICENSE) is the separate proprietary BigNose OS product and is excluded from the AGPL.

The default build is Community. Licensed Pro builds use `BBN_EDITION=pro`; see [the boundary and setup instructions](./docs/OPEN_CORE_BOUNDARY.md). Third-party licenses are preserved in [NOTICE](./NOTICE). The BoomBigNose name and logo are reserved; forks must rebrand under [TRADEMARK.md](./TRADEMARK.md). For commercial terms, contact [boombignose.org](https://boombignose.org).

Copyright © 2026 BoomBigNose AI Co., Ltd.

<div align="center">
<br/>
สร้างด้วย ❤️ ที่กรุงเทพฯ — โดยทีม <b>BoomBigNose</b>
</div>

<!-- BBN:FOOTER:START -->
[Made by BoomBigNose](https://github.com/Boom-Vitt)
<!-- BBN:FOOTER:END -->
