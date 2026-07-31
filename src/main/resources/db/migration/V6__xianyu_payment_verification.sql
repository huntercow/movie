ALTER TABLE xianyu_platform_order
    ADD COLUMN adjusted_amount DECIMAL(12, 2) NULL,
    ADD COLUMN adjusted_at DATETIME(6) NULL,
    ADD COLUMN amount_verification_source VARCHAR(64) NULL,
    ADD COLUMN amount_verified_at DATETIME(6) NULL,
    ADD INDEX idx_xianyu_platform_order_user_chat_status (user_id, chat_id, status);
