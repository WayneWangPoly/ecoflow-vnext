-- Controlled retry after installing exact production migration diagnostics.
begin;
notify pgrst, 'reload schema';
commit;
