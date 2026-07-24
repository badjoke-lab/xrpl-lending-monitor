CREATE INDEX IF NOT EXISTS idx_protocol_events_network_event_hash
  ON protocol_events (network, event_hash);

CREATE INDEX IF NOT EXISTS idx_object_changes_network_transaction_hash
  ON object_changes (network, transaction_hash, node_index, field_name);
