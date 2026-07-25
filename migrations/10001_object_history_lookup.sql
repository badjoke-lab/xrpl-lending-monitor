CREATE INDEX IF NOT EXISTS idx_object_changes_network_object_history
  ON object_changes (
    network,
    object_type,
    object_id,
    ledger_index DESC,
    transaction_index DESC,
    node_index ASC,
    field_name ASC
  );
