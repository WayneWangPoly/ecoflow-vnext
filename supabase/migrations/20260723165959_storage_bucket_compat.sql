-- Keep receiving-document bucket creation compatible with older Storage schemas
-- and the production-schema shadow used by the migration gate.

begin;

alter table storage.buckets
  add column if not exists file_size_limit bigint,
  add column if not exists allowed_mime_types text[];

commit;
