# TREMLY — Salon Booking Marketplace (Saudi Arabia)

A multi-vendor booking marketplace for women's and men's salons, barbershops, spas and personal care. It has three connected interfaces on one PostgreSQL database:

| Interface | Path | Who |
|---|---|---|
| Customer website and booking engine | `/`, `/search`, `/salons/[slug]`, `/salons/[slug]/book`, `/bookings/[ref]`, `/account` | Customers (phone OTP) |
| Salon dashboard | `/dashboard/*` | Salon owners, managers, receptionists, stylists (role based) |
| Super Admin | `/admin/*` | Platform admins |

Arabic is the default language and is right-to-left; English is also supported. The currency is SAR, and times are in Asia/Riyadh.

---

## Quick start (local)

```bash
cp .env.example .env            # set DATABASE_URL, APP_SECRET (openssl rand -hex 32), CRON_SECRET
npm install
npm run db:migrate              # applies db/migrations/*.sql
npm run db:seed                 # OPTIONAL dev data: 5 sample salons, prints admin + owner logins
npm run dev                     # http://localhost:3000
npm test                        # unit + integration tests (needs a Postgres test DB, see below)
```

* With `SMS_PROVIDER=console`, OTP codes are printed in the server log. This only works in development, and the app refuses to start with it in production.
* Tests use `TEST_DATABASE_URL`, which defaults to `postgres://tremly:tremly@localhost:5432/tremly_test`. Each run drops and recreates the schema.
* Run the cron worker every minute: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick`.

## Tech stack

* **Next.js 15 (App Router) + React 19 + TypeScript** handle server rendering, server actions and route handlers.
* **PostgreSQL** is accessed through `postgres` (porsager) with plain SQL migrations. It runs on **Supabase** or any managed Postgres.
* **Tailwind CSS v4** with logical properties, so one codebase serves both RTL and LTR.
* **Zod** validates all inputs. **ExcelJS** produces the Excel exports.
* **Vitest** runs the tests against a real Postgres instance.

The `/api/*` routes are a REST API that accepts either the session cookie or `Authorization: Bearer <token>`. The token is returned by `/api/auth/otp/verify`. This lets future iOS and Android apps reuse the same backend.

## Architecture and modules

```
db/migrations/        0001_init.sql (schema, constraints, ledger), 0002_security.sql (RLS deny-by-default, append-only audit)
src/lib/
  booking/availability.ts   pure slot engine (shifts, breaks, busy, buffer, lead time, interval) — unit tested
  booking/service.ts        create / cancel / reschedule / accept / reject / complete / no-show, hold expiry, promos
  payments/                 provider interface, Moyasar hosted checkout, webhook + server-side verification, refunds
  finance/                  commission rule resolution, append-only ledger, settlements
  notifications/            SMS (Unifonic/Taqnyat), Email (Resend), WhatsApp Cloud API, queue + dispatcher, AR/EN templates
  auth/                     OTP (HMAC-hashed, rate-limited), sessions (hashed tokens), scrypt passwords, RBAC matrix
  catalog.ts, reports.ts, storage.ts, rate-limit.ts, audit.ts
src/app/(site)            customer site     src/app/dashboard   salon dashboard     src/app/admin   super admin
src/app/api               REST + webhook + cron
```

### How double bookings are prevented

The database enforces it, so it holds even if application code has a bug:

```sql
constraint bookings_no_overlap exclude using gist (
  employee_id with =, tstzrange(starts_at, blocked_until, '[)') with &&
) where (status in ('pending_payment','pending_approval','confirmed'))
```

`blocked_until` is the appointment end time plus the salon's buffer. The application also re-computes availability inside the booking transaction. A test fires 8 simultaneous requests for one slot and checks that exactly 1 succeeds (`tests/booking.integration.test.ts`).

### Booking lifecycle

`pending_payment` (slot held for 15 min) → `confirmed` or `pending_approval` → `completed` or `no_show`. A booking can also become `cancelled`, `rejected` or `expired`.

Unpaid holds are released by the cron worker. They are also released inside every booking transaction before the new slot is checked. If a payment arrives after its hold expired, the system takes the slot back when it is still free. If it is no longer free, the payment is refunded automatically.

### Payment statuses

The statuses are `unpaid`, `pending`, `partially_paid` (deposit), `paid`, `cash_pending`, `partially_refunded`, `refunded` and `cancelled`.

**A payment is marked paid only by `reconcilePayment()`.** That function looks the payment up server-to-server with the gateway and checks the amount and currency. The redirect query string and the webhook body are never trusted on their own. Webhooks are authenticated, stored once in `payment_webhook_events` to block replays, and then reconciled. Card data never reaches TREMLY because checkout is hosted by the gateway (PCI SAQ-A).

### Commissions and ledger

* **Rule lookup.** The salon's own rule wins over its category rule, which wins over the default. Online and cash rates are separate. Rules are versioned with `effective_from` and are never edited.
* **Online payment.** When payment is verified, the ledger records `platform_cash +` and `salon_payable +`. At completion the commission moves from `salon_payable` to `platform_revenue`.
* **Cash payment.** The salon holds the money. The commission is recorded as `commission_receivable`, which the salon owes TREMLY. Recording a cash payment never counts as the platform having been paid.
* **Platform-funded campaigns.** When TREMLY runs a campaign, the salon is reimbursed for the discount through a ledger adjustment.
* **Ledger integrity.** The ledger is append-only, enforced by a database trigger. A unique index stops a booking's commission being posted twice.
* **Settlements.** A settlement statement nets online payables against cash receivables for a period. When an admin marks it paid with a bank transfer reference, closing ledger entries are posted.

### Security

* **Login and sessions.** Customers log in with an OTP sent to their phone; codes are HMAC-hashed, expire after 5 minutes, allow 5 attempts, and have a send cooldown. Partners and admins can also use an email and scrypt-hashed password. Sessions use opaque random tokens stored as SHA-256 hashes, in httpOnly SameSite cookies.
* **Access control.** Roles are checked on every server action and API call. The salon permission matrix lives in `src/lib/auth/rbac.ts`. Stylists can only see and act on their own appointments. Every query is scoped by salon.
* **Request protection.**
  * Rate limiting is backed by Postgres, so it works across server instances.
  * State-changing APIs check the request origin.
  * All inputs are validated with Zod.
  * Uploads are checked for file type, size and magic bytes.
  * Security headers include HSTS, frame options, nosniff and Permissions-Policy.
* **Database.** Row-level security is on with deny-by-default for Supabase's `anon` and `authenticated` roles, so all access goes through the server. The audit log is append-only.
* **Privacy (PDPL).**
  * Staff photos are hidden by default for women's salons.
  * Reviewers are shown by first name only.
  * Salons see a customer's phone only for confirmed bookings; otherwise it is masked.
  * Customers can delete their own account. Personal data is anonymised, and financial records are kept for legal reasons.

## Integrations: status and what's missing

Nothing here is simulated. Until credentials are added, a feature reports that it is **not configured**. For example, the booking wizard offers only "pay at salon", and the Admin dashboard shows a red integration status.

| Integration | Code | You must provide |
|---|---|---|
| **Moyasar** (mada, Visa, Mastercard, Apple Pay, STC Pay) | `src/lib/payments/moyasar.ts` | Merchant account and KYC approval. `MOYASAR_SECRET_KEY` and `MOYASAR_PUBLISHABLE_KEY` (start with `sk_test_` / `pk_test_`). `MOYASAR_WEBHOOK_SECRET`, with a webhook pointing to `{APP_URL}/api/payments/webhook` for `payment_paid`, `payment_failed` and `payment_refunded`. Apple Pay needs domain verification in the Moyasar dashboard. |
| **SMS / OTP**: Unifonic or Taqnyat | `src/lib/notifications/providers.ts` | A CST-registered sender ID, plus `UNIFONIC_APP_SID` or `TAQNYAT_BEARER_TOKEN`. |
| **Email**: Resend | same | `RESEND_API_KEY`, and `EMAIL_FROM` on a verified domain. |
| **WhatsApp** Cloud API | same | A Meta Business account, `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`, and approved templates named `tremly_booking_confirmed`, `tremly_booking_reminder`, `tremly_booking_cancelled` and `tremly_booking_rescheduled`. |
| **Storage**: Supabase Storage | `src/lib/storage.ts` | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, plus a public bucket `tremly-media`. Local disk is for development only. |
| **Analytics**: GA4 | `src/app/layout.tsx` | `NEXT_PUBLIC_GA_ID`. The booking wizard fires a `begin_checkout` event. |

To switch from test to live payments, change the Moyasar keys from `sk_test_` to `sk_live_`. The Admin dashboard (Payments) shows which mode is active.

## Deployment

1. **Create the database.** Make a Supabase project (pick an EU or ME region close to KSA) and copy the pooled connection string into `DATABASE_URL`.
2. **Migrate.** Run `DATABASE_URL=... npm run db:migrate`.
3. **Create the first admin.** Run `ADMIN_PASSWORD='…' npx tsx scripts/create-admin.ts admin@yourdomain.sa +9665XXXXXXXX "Name"`. Use `npm run db:seed` on staging only.
4. **Deploy.** Deploy to Vercel or any Node 20+ host with `npm run build && npm start`, and set every variable in `.env.example`.
5. **Schedule the cron worker.** Run `/api/cron/tick` every minute. `vercel.json` already declares it; per-minute cron needs Vercel Pro. Otherwise use Supabase `pg_cron` + `pg_net`, or any external scheduler, sending `Authorization: Bearer $CRON_SECRET`.
6. **Configure the gateway webhook** in the Moyasar dashboard.

## Launch checklist

- [ ] Moyasar merchant approved. End-to-end payment tested with test cards (mada, Visa, Apple Pay). Refunds tested. Then switch to live keys.
- [ ] SMS sender ID approved. OTP delivered to real STC, Mobily and Zain numbers.
- [ ] `APP_SECRET` and `CRON_SECRET` are random, and stored only in the hosting provider's secret store.
- [ ] Supabase point-in-time recovery or daily backups are enabled.
- [ ] Privacy policy and terms reviewed by Saudi counsel (PDPL, e-commerce law). VAT registration confirmed.
- [ ] `APP_URL` is set to the production domain, the sitemap has been submitted to Google Search Console, and GA4 is connected.
