CREATE INDEX IF NOT EXISTS idx_protocol_events_network_event_hash
  ON protocol_events (network, event_hash);

CREATE INDEX IF NOT EXISTS idx_object_changes_network_transaction_hash
  ON object_changes (network, transaction_hash, node_index, field_name);

CREATE TABLE IF NOT EXISTS fast_lane_transaction_lookup_shards (
  network TEXT NOT NULL,
  epoch_id TEXT NOT NULL,
  start_ledger_index INTEGER NOT NULL,
  end_ledger_index INTEGER NOT NULL,
  shard_prefix TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (network, epoch_id, start_ledger_index, shard_prefix)
);

CREATE INDEX IF NOT EXISTS idx_fast_lane_transaction_lookup_prefix
  ON fast_lane_transaction_lookup_shards (
    network,
    epoch_id,
    shard_prefix,
    end_ledger_index DESC
  );
