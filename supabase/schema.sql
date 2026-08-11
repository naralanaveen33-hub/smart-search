-- SwiftSearch — Supabase schema
--
-- Optional. With no SUPABASE_URL / SUPABASE_SERVICE_KEY configured the backend
-- runs entirely on local JSON storage and none of this is required.
--
-- Apply with either:
--   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
--   or paste into the Supabase SQL editor
--
-- The backend writes through the service key from the server only. These tables
-- are never queried directly from the browser, so RLS is enabled and left
-- without permissive policies: the service role bypasses RLS, everyone else is
-- denied by default. Add your own policies before exposing them to a client.

-- ---------------------------------------------------------------- documents

create table if not exists public.documents (
    id           text        primary key,
    title        text        not null default '',
    file_name    text        not null default '',
    size_bytes   bigint      not null default 0 check (size_bytes >= 0),
    status       text        not null default 'ready'
                             check (status in ('ready', 'processing', 'error')),
    source       text        not null default 'upload'
                             check (source in ('upload', 'demo')),
    uploaded_at  timestamptz not null default now(),
    indexed      boolean     not null default false,
    term_count   integer     not null default 0 check (term_count >= 0),
    storage_url  text,
    preview      text        not null default '',
    -- Extracted, searchable plain text. This is what the BSBI indexer reads, so
    -- it must survive a machine change: without it a second host sees document
    -- metadata but has nothing to index.
    --
    -- Deliberately NOT selected by list/analytics queries — see
    -- DOCUMENT_COLUMNS in backend/app/database/store.py. Fetch it only for
    -- indexing, preview, and explicit text retrieval.
    text         text        not null default ''
);

comment on table public.documents is
    'Corpus metadata plus extracted text. Original uploaded files live in Storage.';
comment on column public.documents.text is
    'Extracted plain text for BSBI indexing. Excluded from list queries by design.';

create index if not exists documents_uploaded_at_idx
    on public.documents (uploaded_at desc);
create index if not exists documents_indexed_idx
    on public.documents (indexed);

-- ----------------------------------------------------------- search history

create table if not exists public.search_history (
    id           bigint generated always as identity primary key,
    query        text        not null check (length(btrim(query)) > 0),
    mode         text        not null default 'all'
                             check (mode in ('all', 'and', 'or', 'phrase')),
    results      integer     not null default 0 check (results >= 0),
    took_seconds double precision not null default 0 check (took_seconds >= 0),
    created_at   timestamptz not null default now()
);

comment on table public.search_history is
    'One row per executed query. Pagination requests are not recorded.';

create index if not exists search_history_created_at_idx
    on public.search_history (created_at desc);
create index if not exists search_history_query_idx
    on public.search_history (lower(btrim(query)));

-- --------------------------------------------------------------- index runs

create table if not exists public.index_runs (
    id                   bigint generated always as identity primary key,
    created_at           timestamptz not null default now(),
    documents            integer     not null default 0 check (documents >= 0),
    unique_terms         integer     not null default 0 check (unique_terms >= 0),
    postings             bigint      not null default 0 check (postings >= 0),
    blocks               integer     not null default 0 check (blocks >= 0),
    avg_block_size       integer     not null default 0 check (avg_block_size >= 0),
    seconds              double precision not null default 0 check (seconds >= 0),
    index_size_bytes     bigint      not null default 0 check (index_size_bytes >= 0),
    block_size           integer     not null default 0 check (block_size > 0),
    peak_memory_entries  integer     not null default 0 check (peak_memory_entries >= 0),
    peak_memory_used     integer     not null default 0
                                     check (peak_memory_used between 0 and 100)
);

comment on table public.index_runs is
    'One row per completed BSBI build. peak_memory_* describe the block buffer, not OS memory.';

create index if not exists index_runs_created_at_idx
    on public.index_runs (created_at desc);

-- ---------------------------------------------------------------------- RLS

alter table public.documents      enable row level security;
alter table public.search_history enable row level security;
alter table public.index_runs     enable row level security;

-- ------------------------------------------------------- upgrade from v1
-- Safe to re-run. Adds documents.text to a project created before extracted
-- text was persisted remotely. New installs already have it from the create
-- table above; this is a no-op for them.

alter table public.documents
    add column if not exists text text not null default '';

-- ------------------------------------------------------------------ storage
-- Private bucket for the original uploaded files. The backend uploads with the
-- service key; nothing is ever served directly to the browser.

insert into storage.buckets (id, name, public)
values ('swiftsearch-documents', 'swiftsearch-documents', false)
on conflict (id) do nothing;
