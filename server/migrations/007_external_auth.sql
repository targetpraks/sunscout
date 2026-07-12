-- Map verified external JWT subjects (Clerk/Auth0) to internal users.
alter table app_user add column if not exists external_sub text unique;
create index if not exists app_user_external_sub_idx on app_user (external_sub) where external_sub is not null;
