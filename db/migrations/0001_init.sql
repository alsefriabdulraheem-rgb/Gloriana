-- TREMLY core schema. PostgreSQL 15+ (Supabase compatible).
-- All money is stored in halalas (integer, 1 SAR = 100 halalas) to avoid float errors.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create extension if not exists citext;

-- ---------------------------------------------------------------- enums
create type user_role as enum ('customer', 'salon_owner', 'salon_staff', 'admin');
create type user_status as enum ('active', 'suspended', 'deleted');
create type salon_audience as enum ('women', 'men');
create type salon_status as enum ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'deactivated');
create type member_role as enum ('owner', 'manager', 'receptionist', 'stylist');
create type booking_status as enum (
  'pending_payment',   -- slot held until hold_expires_at while customer pays online
  'pending_approval',  -- salon requires manual acceptance
  'confirmed',
  'completed',
  'cancelled',
  'rejected',
  'no_show',
  'expired'            -- unpaid hold released automatically
);
create type payment_status as enum (
  'unpaid', 'pending', 'partially_paid', 'paid', 'cash_pending',
  'partially_refunded', 'refunded', 'cancelled'
);
create type payment_method as enum ('online', 'deposit', 'cash');
create type payment_tx_status as enum ('initiated', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded', 'voided');
create type refund_status as enum ('requested', 'succeeded', 'failed');
create type settlement_status as enum ('draft', 'issued', 'paid', 'void');
create type review_status as enum ('published', 'hidden', 'reported');
create type notif_channel as enum ('sms', 'email', 'whatsapp', 'in_app');
create type notif_status as enum ('queued', 'sent', 'failed', 'skipped');
create type complaint_status as enum ('open', 'in_progress', 'resolved', 'rejected');
create type discount_type as enum ('percent', 'fixed');

-- ---------------------------------------------------------------- users & auth
create table users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,                         -- E.164, e.g. +9665XXXXXXXX
  phone_verified_at timestamptz,
  email citext unique,
  full_name text,
  password_hash text,                        -- scrypt; optional (OTP login is primary)
  role user_role not null default 'customer',
  status user_status not null default 'active',
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  gender text check (gender in ('female', 'male')),
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,           -- sha256 of opaque token; raw token only in cookie
  user_agent text,
  ip text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on sessions(user_id);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,                   -- HMAC-SHA256(code)
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on otp_codes(phone, created_at desc);

create table rate_limits (
  key text primary key,
  count int not null,
  window_start timestamptz not null
);

create table notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  sms boolean not null default true,
  email boolean not null default true,
  whatsapp boolean not null default false,
  reminders boolean not null default true,
  marketing boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- salons
create table salons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  name_ar text not null,
  name_en text,
  description_ar text,
  description_en text,
  audience salon_audience not null,
  category text not null default 'salon' check (category in ('salon', 'barbershop', 'spa', 'nails', 'makeup', 'skincare', 'grooming')),
  logo_url text,
  cover_url text,
  phone text,
  email citext,
  commercial_registration text,              -- CR number (required for approval)
  vat_number text,
  status salon_status not null default 'draft',
  status_reason text,
  is_featured boolean not null default false,
  featured_rank int,
  -- booking policy
  slot_interval_min int not null default 15 check (slot_interval_min in (5, 10, 15, 20, 30, 45, 60)),
  buffer_min int not null default 0 check (buffer_min between 0 and 120),
  min_lead_min int not null default 60 check (min_lead_min between 0 and 10080),
  max_advance_days int not null default 60 check (max_advance_days between 1 and 365),
  requires_approval boolean not null default false,
  accepts_cash boolean not null default true,
  accepts_online boolean not null default true,
  deposit_percent int not null default 0 check (deposit_percent between 0 and 100),
  free_cancel_hours int not null default 24 check (free_cancel_hours between 0 and 720),
  late_cancel_fee_percent int not null default 0 check (late_cancel_fee_percent between 0 and 100),
  max_reschedules int not null default 2 check (max_reschedules between 0 and 10),
  cancellation_policy_ar text,
  cancellation_policy_en text,
  show_staff_photos boolean not null default true,  -- women's salons default to false (privacy)
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  approved_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on salons(status, audience);

create table salon_members (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role member_role not null,
  employee_id uuid,                          -- set when the member is also a bookable employee
  created_at timestamptz not null default now(),
  unique (salon_id, user_id)
);

create table salon_branches (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name_ar text not null,
  name_en text,
  city text not null,
  neighborhood text,
  address_ar text,
  address_en text,
  lat numeric(9,6),
  lng numeric(9,6),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on salon_branches(salon_id);
create index on salon_branches(city);

-- weekday: 0 = Sunday ... 6 = Saturday (local Asia/Riyadh time)
create table branch_hours (
  branch_id uuid not null references salon_branches(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  primary key (branch_id, weekday),
  check (is_closed or (open_time is not null and close_time is not null and open_time < close_time))
);

create table branch_holidays (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references salon_branches(id) on delete cascade,
  date date not null,
  reason text,
  unique (branch_id, date)
);

create table salon_media (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  url text not null,
  caption text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- services & staff
create table services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name_ar text not null,
  name_en text,
  description_ar text,
  description_en text,
  category text not null default 'hair',
  duration_min int not null check (duration_min between 5 and 600),
  price_halalas int not null check (price_halalas >= 0),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on services(salon_id);

create table employees (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  branch_id uuid not null references salon_branches(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  display_name_ar text not null,
  display_name_en text,
  title_ar text,
  title_en text,
  bio_ar text,
  bio_en text,
  photo_url text,
  is_active boolean not null default true,
  rating_avg numeric(3,2) not null default 0,
  rating_count int not null default 0,
  created_at timestamptz not null default now()
);
create index on employees(salon_id);

alter table salon_members add constraint salon_members_employee_fk foreign key (employee_id) references employees(id) on delete set null;

create table employee_services (
  employee_id uuid not null references employees(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  primary key (employee_id, service_id)
);

create table employee_schedules (
  employee_id uuid not null references employees(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  primary key (employee_id, weekday, start_time),
  check (start_time < end_time)
);

create table employee_breaks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time)
);

-- days off, vacations and manually blocked slots
create table employee_time_off (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'time_off' check (kind in ('time_off', 'blocked', 'sick')),
  reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index on employee_time_off(employee_id, starts_at);

-- ---------------------------------------------------------------- promotions
create table promotions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references salons(id) on delete cascade,   -- null = platform-wide campaign (funded by platform)
  code citext,
  title_ar text not null,
  title_en text,
  discount_type discount_type not null,
  discount_value int not null check (discount_value > 0),   -- percent (1-100) or halalas
  min_subtotal_halalas int not null default 0,
  max_discount_halalas int,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  max_redemptions int,
  per_customer_limit int not null default 1,
  redemptions int not null default 0,
  is_active boolean not null default true,
  is_public boolean not null default true,                  -- shown on offers page
  created_at timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 100)
);
create unique index promotions_code_unique on promotions (coalesce(salon_id, '00000000-0000-0000-0000-000000000000'::uuid), code) where code is not null;

-- ---------------------------------------------------------------- bookings
create sequence booking_ref_seq;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,                          -- e.g. TR-7K3D9Q
  salon_id uuid not null references salons(id),
  branch_id uuid not null references salon_branches(id),
  customer_id uuid not null references users(id),
  employee_id uuid not null references employees(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,                      -- ends_at + salon buffer
  status booking_status not null,
  payment_method payment_method not null,
  payment_status payment_status not null default 'unpaid',
  subtotal_halalas int not null,
  discount_halalas int not null default 0,
  total_halalas int not null,
  amount_due_online_halalas int not null default 0,        -- deposit or full amount
  amount_paid_halalas int not null default 0,
  amount_refunded_halalas int not null default 0,
  cash_collected_halalas int not null default 0,
  promotion_id uuid references promotions(id),
  hold_expires_at timestamptz,
  customer_note text,
  reschedule_count int not null default 0,
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancel_reason text,
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at and ends_at <= blocked_until),
  check (total_halalas = subtotal_halalas - discount_halalas and total_halalas >= 0),
  -- THE double-booking guard: an employee can never hold two active, overlapping bookings.
  constraint bookings_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status in ('pending_payment', 'pending_approval', 'confirmed'))
);
create index on bookings(salon_id, starts_at);
create index on bookings(customer_id, starts_at desc);
create index on bookings(status, hold_expires_at) where status = 'pending_payment';

create table booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  service_id uuid not null references services(id),
  service_name_ar text not null,                           -- snapshot at booking time
  service_name_en text,
  duration_min int not null,
  price_halalas int not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  sort int not null default 0
);
create index on booking_items(booking_id);

create table booking_events (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  actor_id uuid references users(id),
  event text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on booking_events(booking_id);

create table promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references promotions(id),
  booking_id uuid not null references bookings(id) on delete cascade,
  customer_id uuid not null references users(id),
  discount_halalas int not null,
  created_at timestamptz not null default now(),
  unique (booking_id)
);

-- ---------------------------------------------------------------- payments
create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id),
  provider text not null,                                  -- 'moyasar'
  provider_ref text unique,                                -- gateway invoice/payment id
  provider_payment_id text,                                -- gateway payment id after success (for refunds)
  idempotency_key text not null unique,
  amount_halalas int not null check (amount_halalas > 0),
  currency text not null default 'SAR',
  kind payment_method not null,                            -- online (full) or deposit
  status payment_tx_status not null default 'initiated',
  checkout_url text,
  source_type text,                                        -- mada / creditcard / applepay / stcpay (reported by gateway)
  refunded_halalas int not null default 0,
  verified_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on payments(booking_id);

-- webhook inbox: every delivery is stored once (idempotent replay protection)
create table payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  booking_id uuid not null references bookings(id),
  amount_halalas int not null check (amount_halalas > 0),
  reason text,
  status refund_status not null default 'requested',
  provider_ref text,
  requested_by uuid references users(id),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- commissions & ledger
-- Resolution order: salon-specific rule > category rule > default rule.
create table commission_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('default', 'category', 'salon')),
  salon_id uuid references salons(id) on delete cascade,
  category text,
  online_percent numeric(5,2) not null check (online_percent between 0 and 100),
  cash_percent numeric(5,2) not null check (cash_percent between 0 and 100),
  effective_from timestamptz not null default now(),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check ((scope = 'salon') = (salon_id is not null)),
  check ((scope = 'category') = (category is not null))
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  salon_id uuid not null references salons(id),
  period_start date not null,
  period_end date not null,
  online_gross_halalas int not null default 0,
  online_commission_halalas int not null default 0,
  cash_gross_halalas int not null default 0,
  cash_commission_halalas int not null default 0,
  refunds_halalas int not null default 0,
  -- positive: platform owes salon; negative: salon owes platform
  net_payable_halalas int not null default 0,
  status settlement_status not null default 'draft',
  paid_at timestamptz,
  payment_reference text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- Append-only ledger. Each row is one movement from the perspective of an account.
-- accounts: platform_cash (money held by TREMLY from online payments), salon_payable (owed to salon),
-- platform_revenue (commission earned), commission_receivable (owed by salon for cash bookings), refunds.
create table ledger_entries (
  id bigserial primary key,
  salon_id uuid not null references salons(id),
  booking_id uuid references bookings(id),
  payment_id uuid references payments(id),
  refund_id uuid references refunds(id),
  settlement_id uuid references settlements(id),
  entry_type text not null check (entry_type in (
    'online_payment', 'online_commission', 'cash_collected', 'cash_commission',
    'refund', 'refund_commission_reversal', 'settlement_payout', 'settlement_collection', 'adjustment'
  )),
  account text not null check (account in ('platform_cash', 'salon_payable', 'platform_revenue', 'commission_receivable', 'salon_cash')),
  amount_halalas int not null,                             -- signed
  commission_percent numeric(5,2),
  memo text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index on ledger_entries(salon_id, created_at);
create index on ledger_entries(settlement_id);
-- one commission entry per booking per type (prevents double charging on retries)
create unique index ledger_once_per_booking on ledger_entries(booking_id, entry_type, account)
  where entry_type in ('online_commission', 'cash_commission', 'cash_collected');

create or replace function ledger_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'ledger_entries is append-only'; end if;
  -- only settlement linkage may be set once
  if new.amount_halalas <> old.amount_halalas or new.account <> old.account or new.entry_type <> old.entry_type
     or (old.settlement_id is not null and new.settlement_id is distinct from old.settlement_id) then
    raise exception 'ledger_entries is append-only';
  end if;
  return new;
end $$;
create trigger ledger_immutable before update or delete on ledger_entries for each row execute function ledger_immutable();

-- ---------------------------------------------------------------- reviews
create table reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(id),  -- only verified bookings can review
  salon_id uuid not null references salons(id),
  employee_id uuid references employees(id),
  customer_id uuid not null references users(id),
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 2000),
  salon_reply text,
  status review_status not null default 'published',
  created_at timestamptz not null default now()
);
create index on reviews(salon_id, created_at desc);

create table review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews(id) on delete cascade,
  reporter_id uuid not null references users(id),
  reason text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id)
);

-- ---------------------------------------------------------------- notifications, complaints, audit
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  channel notif_channel not null,
  recipient text not null,
  template text not null,
  payload jsonb not null default '{}',
  body text not null,
  status notif_status not null default 'queued',
  attempts int not null default 0,
  error text,
  provider_ref text,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications(status, send_after) where status = 'queued';
create index on notifications(user_id, created_at desc);

create table complaints (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid references users(id),
  salon_id uuid references salons(id),
  booking_id uuid references bookings(id),
  subject text not null,
  body text not null,
  status complaint_status not null default 'open',
  resolution text,
  assigned_to uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id bigserial primary key,
  actor_id uuid references users(id),
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index on audit_logs(entity, entity_id);
create index on audit_logs(created_at desc);

create table platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

-- default commission: 10% on online bookings, 10% on cash bookings
insert into commission_rules (scope, online_percent, cash_percent, effective_from) values ('default', 10, 10, '2020-01-01');
insert into platform_settings (key, value) values
  ('payment_hold_minutes', '15'),
  ('reminder_hours_before', '24');
