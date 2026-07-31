ALTER TABLE agent_instance
    ADD COLUMN current_xianyu_account_id VARCHAR(128) NULL AFTER last_heartbeat_at,
    ADD COLUMN current_xianyu_nickname VARCHAR(128) NULL AFTER current_xianyu_account_id,
    ADD COLUMN xianyu_account_updated_at DATETIME(6) NULL AFTER current_xianyu_nickname;
