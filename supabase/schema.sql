create extension if not exists pgcrypto;

create table if not exists staff (
  id text primary key,
  username text not null unique,
  password_hash text not null,
  name text not null default '',
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id text primary key,
  phone text not null unique,
  name text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key,
  customer_id text not null references customers(id) on delete cascade,
  order_type text not null default 'tailoring',
  status text not null default 'pending',
  due_date text not null default '',
  total numeric not null default 0,
  paid numeric not null default 0,
  measurements text not null default '',
  notes text not null default '',
  quantity integer not null default 0,
  garments jsonb not null default '{}'::jsonb,
  taken_by text not null default 'Staff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_photos (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  storage_path text not null,
  public_url text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_customer_id on orders(customer_id);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_customers_phone on customers(phone);

-- seed default staff
insert into staff (id, username, password_hash, name, is_admin)
values ('admin1', 'admin', encode(digest('goodwill123', 'sha256'), 'hex'), 'Admin', true)
on conflict (username) do nothing;
