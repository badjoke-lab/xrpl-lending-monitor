ALTER TABLE fast_lane_queue_slots
ADD COLUMN next_cron TEXT
CHECK (next_cron IN ('queue-self-schedule', 'queue-catch-up'));
