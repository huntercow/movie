ALTER TABLE xianyu_platform_order
    ADD COLUMN delivery_attempt_id VARCHAR(64) NULL,
    ADD COLUMN delivery_attempt_started_at DATETIME(6) NULL,
    ADD COLUMN delivery_attempt_outcome VARCHAR(16) NULL,
    ADD COLUMN delivery_attempt_channel VARCHAR(64) NULL,
    ADD COLUMN delivery_attempt_error_message VARCHAR(1024) NULL,
    ADD COLUMN delivery_outcome_recorded_at DATETIME(6) NULL,
    ADD UNIQUE INDEX uk_xianyu_platform_order_user_delivery_attempt (user_id, delivery_attempt_id);

ALTER TABLE xianyu_delivery_record
    ADD COLUMN delivery_attempt_id VARCHAR(64) NULL,
    ADD UNIQUE INDEX uk_xianyu_delivery_record_user_delivery_attempt (user_id, delivery_attempt_id);
