alter function public.xrpl_complete_portable_commit_phase(
  text,
  text,
  timestamptz,
  text,
  text
) rename to xrpl_complete_portable_commit_phase_strict;

create or replace function public.xrpl_complete_portable_commit_phase(
  p_owner text,
  p_message_id text,
  p_completed_at timestamptz,
  p_reference_rows_json text,
  p_reference_rows_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_input_rows jsonb;
  v_actual_input_digest text;
  v_row_count integer;
  v_reference_shape boolean;
  v_payload_shape boolean;
  v_adapted_rows jsonb;
  v_adapted_rows_json text;
  v_adapted_rows_digest text;
begin
  if p_reference_rows_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid reference-row digest';
  end if;

  v_actual_input_digest := encode(
    extensions.digest(convert_to(p_reference_rows_json, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_actual_input_digest <> p_reference_rows_digest then
    raise exception 'reference-row digest mismatch';
  end if;

  begin
    v_input_rows := p_reference_rows_json::jsonb;
  exception when others then
    raise exception 'reference-row JSON is invalid';
  end;
  if jsonb_typeof(v_input_rows) <> 'array' then
    raise exception 'reference-row JSON must be an array';
  end if;

  v_row_count := jsonb_array_length(v_input_rows);
  if v_row_count = 0 then
    return public.xrpl_complete_portable_commit_phase_strict(
      p_owner,
      p_message_id,
      p_completed_at,
      p_reference_rows_json,
      p_reference_rows_digest
    );
  end if;

  select
    bool_and(row_value ? 'valueJson' and not (row_value ? 'value')),
    bool_and(row_value ? 'value' and not (row_value ? 'valueJson'))
  into v_reference_shape, v_payload_shape
  from jsonb_array_elements(v_input_rows) as row_value;

  if coalesce(v_reference_shape, false) then
    return public.xrpl_complete_portable_commit_phase_strict(
      p_owner,
      p_message_id,
      p_completed_at,
      p_reference_rows_json,
      p_reference_rows_digest
    );
  end if;

  if not coalesce(v_payload_shape, false) then
    raise exception 'portable commit rows use an unsupported or mixed shape';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'semanticClass', row_value->'semanticClass',
        'canonicalKey', row_value->'canonicalKey',
        'sourceLedgerIndex', row_value->'sourceLedgerIndex',
        'sourceLedgerHash', row_value->'sourceLedgerHash',
        'sourceTransactionHash', row_value->'sourceTransactionHash',
        'objectId', row_value->'objectId',
        'relationshipIds', row_value->'relationshipIds',
        'valueJson', case
          when coalesce((row_value->>'isTombstone')::boolean, false)
            and row_value->'value' = 'null'::jsonb then null
          else (row_value->'value')::text
        end,
        'isTombstone', row_value->'isTombstone'
      )
      order by row_ordinality
    ),
    '[]'::jsonb
  ) into v_adapted_rows
  from jsonb_array_elements(v_input_rows) with ordinality
    as payload_row(row_value, row_ordinality);

  if jsonb_array_length(v_adapted_rows) <> v_row_count then
    raise exception 'portable retained payload adaptation count mismatch';
  end if;

  v_adapted_rows_json := v_adapted_rows::text;
  v_adapted_rows_digest := encode(
    extensions.digest(convert_to(v_adapted_rows_json, 'UTF8'), 'sha256'),
    'hex'
  );

  return public.xrpl_complete_portable_commit_phase_strict(
    p_owner,
    p_message_id,
    p_completed_at,
    v_adapted_rows_json,
    v_adapted_rows_digest
  );
end;
$$;

revoke all on function public.xrpl_complete_portable_commit_phase_strict(
  text, text, timestamptz, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.xrpl_complete_portable_commit_phase(
  text, text, timestamptz, text, text
) from public, anon, authenticated;

grant execute on function public.xrpl_complete_portable_commit_phase(
  text, text, timestamptz, text, text
) to service_role;
