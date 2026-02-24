-- Enable pgvector extension
create extension if not exists vector;

-- Table: users (Managed by Admin)
create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table: activation_codes (Admin generated 4-letter codes)
create table activation_codes (
  id uuid primary key default gen_random_uuid(),
  code varchar(4) not null unique check (code ~ '^[A-Z]{4}$'),
  user_id uuid not null references users(id) on delete cascade,
  max_uses integer not null default 3,
  usage_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table: user_devices (Track which devices activated which code)
create table user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  activation_code_id uuid not null references activation_codes(id) on delete cascade,
  device_fingerprint text not null,
  is_active boolean not null default true,
  last_active_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id, device_fingerprint)
);

-- Table: system_instructions (Cloud sync of user's custom instructions)
create table system_instructions (
  user_id uuid primary key references users(id) on delete cascade,
  content text not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Table: user_vectors (Continuous memory)
-- Using 768 dimensions for models like text-embedding-004
create table user_vectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  content text not null,     -- The summarized text
  embedding vector(3072),     -- The vector embedding
  metadata jsonb,            -- e.g. {"source": "conversation", "conv_id": "conv-123"}
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Indexes for performance
create index on user_devices(user_id);
create index on user_devices(device_fingerprint);
create index on activation_codes(user_id);
create index on activation_codes(code);
-- HNSW index for vector similarity search (cosine distance)
-- Note: We skip HNSW index because pgvector restricts hnsw to 2000 dimensions,
-- and exact search is extremely fast for personal user chat histories anyway.
-- create index on user_vectors using hnsw (embedding vector_cosine_ops);


-- Setup Row Level Security (RLS)
-- We might handle security primarily through our Next.js API routes (Server-Side),
-- but it's good practice to enable RLS anyway if we ever query directly from the client.
-- Currently, we assume the API routes use the SUPABASE_SERVICE_ROLE_KEY to bypass RLS,
-- or we use Anon key with JWT containing the user_id.

alter table users enable row level security;
alter table activation_codes enable row level security;
alter table user_devices enable row level security;
alter table system_instructions enable row level security;
alter table user_vectors enable row level security;

-- Example RLS policies (adjust if using Anon key from client)
-- Allow users to read/update their own instructions
create policy "Users can read own system instructions" on system_instructions
  for select using (auth.uid() = user_id);

create policy "Users can modify own system instructions" on system_instructions
  for all using (auth.uid() = user_id);

-- Vectors RLS
create policy "Users can read own vectors" on user_vectors
  for select using (auth.uid() = user_id);

create policy "Users can insert own vectors" on user_vectors
  for insert with check (auth.uid() = user_id);

create policy "Users can delete own vectors" on user_vectors
  for delete using (auth.uid() = user_id);
