drop function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization();
drop function xrpl_resource_guard_v2.qualify_transfer_on_completion();
drop function public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone);
drop function public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone);
drop function xrpl_resource_restore_v1.build_restored_accounting_state(text);
drop table xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.targets;
drop schema xrpl_resource_restore_v1;
