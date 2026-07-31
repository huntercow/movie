-- The original application created these business tables with Hibernate.  Keep
-- the bootstrap idempotent so an existing installation can continue through
-- V6 without changing any published migration, while a new installation gets
-- the same legacy schema before the dependent migrations run.

CREATE TABLE IF NOT EXISTS bot_message (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    wechat_id VARCHAR(128) NOT NULL,
    message_id VARCHAR(128) NOT NULL,
    customer_no VARCHAR(64) NOT NULL,
    quote_no VARCHAR(64) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_bot_message_wechat_message (wechat_id, message_id),
    KEY idx_bot_message_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    version BIGINT NULL,
    customer_no VARCHAR(64) NOT NULL,
    wechat_id VARCHAR(128) NOT NULL,
    nickname VARCHAR(128) NULL,
    avatar_url VARCHAR(512) NULL,
    remark VARCHAR(512) NULL,
    latest_quote_no VARCHAR(64) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_customer_customer_no (customer_no),
    UNIQUE KEY uk_customer_wechat_id (wechat_id),
    KEY idx_customer_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_record (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    version BIGINT NULL,
    payment_record_no VARCHAR(64) NOT NULL,
    customer_no VARCHAR(64) NOT NULL,
    quote_no VARCHAR(64) NOT NULL,
    payment_no VARCHAR(128) NULL,
    amount DECIMAL(12, 2) NOT NULL,
    proof_image_url VARCHAR(512) NULL,
    remark VARCHAR(512) NULL,
    confirmer VARCHAR(64) NULL,
    confirmed_at DATETIME(6) NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_payment_record_no (payment_record_no),
    UNIQUE KEY uk_payment_record_payment_no (payment_no),
    KEY idx_payment_record_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_order (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    version BIGINT NULL,
    order_no VARCHAR(64) NOT NULL,
    quote_no VARCHAR(64) NOT NULL,
    customer_id VARCHAR(255) NOT NULL,
    payment_no VARCHAR(128) NULL,
    final_price DECIMAL(12, 2) NOT NULL,
    total_price DECIMAL(12, 2) NOT NULL,
    upstream_order_no VARCHAR(255) NULL,
    submit_retry_count INT NULL,
    last_submit_error VARCHAR(1024) NULL,
    upstream_order_id VARCHAR(255) NULL,
    upstream_submit_request LONGTEXT NULL,
    upstream_submit_response LONGTEXT NULL,
    upstream_pay_request LONGTEXT NULL,
    upstream_pay_response LONGTEXT NULL,
    upstream_cancel_request LONGTEXT NULL,
    upstream_cancel_response LONGTEXT NULL,
    upstream_detail_response LONGTEXT NULL,
    upstream_order_status INT NULL,
    ticket_code_info LONGTEXT NULL,
    last_sync_error VARCHAR(1024) NULL,
    submitted_at DATETIME(6) NULL,
    paid_at DATETIME(6) NULL,
    canceled_at DATETIME(6) NULL,
    last_sync_at DATETIME(6) NULL,
    issued_at DATETIME(6) NULL,
    refunded_at DATETIME(6) NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_ticket_order_order_no (order_no),
    UNIQUE KEY uk_ticket_order_payment_no (payment_no),
    KEY idx_ticket_order_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_quote (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    quote_no VARCHAR(64) NOT NULL,
    customer_id VARCHAR(255) NULL,
    channel VARCHAR(255) NULL,
    image_url VARCHAR(255) NULL,
    upstream_image_id VARCHAR(255) NULL,
    ocr_task_id VARCHAR(255) NULL,
    province_name VARCHAR(255) NULL,
    city_name VARCHAR(255) NULL,
    area_name VARCHAR(255) NULL,
    city_code VARCHAR(255) NULL,
    cinema_id VARCHAR(255) NULL,
    cinema_code VARCHAR(255) NULL,
    cinema_address VARCHAR(255) NULL,
    film_id VARCHAR(255) NULL,
    film_img VARCHAR(512) NULL,
    custom_film_type INT NULL,
    show_id VARCHAR(255) NULL,
    movie_name VARCHAR(255) NULL,
    cinema_name VARCHAR(255) NULL,
    show_time DATETIME(6) NULL,
    hall_name VARCHAR(255) NULL,
    plan_type VARCHAR(255) NULL,
    seat_count INT NULL,
    seats_json VARCHAR(1024) NULL,
    seats_and_price_json VARCHAR(2048) NULL,
    max_price VARCHAR(255) NULL,
    total_image_price VARCHAR(255) NULL,
    upstream_price DECIMAL(12, 2) NOT NULL,
    final_price DECIMAL(12, 2) NOT NULL,
    total_price DECIMAL(12, 2) NOT NULL,
    profit DECIMAL(12, 2) NOT NULL,
    status VARCHAR(32) NOT NULL,
    upstream_raw_response VARCHAR(2048) NULL,
    official_quotation_id VARCHAR(255) NULL,
    official_quotation_channel VARCHAR(255) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_ticket_quote_quote_no (quote_no),
    KEY idx_ticket_quote_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xianyu_buyer (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    buyer_user_id VARCHAR(128) NOT NULL,
    nickname VARCHAR(128) NULL,
    avatar_url VARCHAR(512) NULL,
    latest_quote_no VARCHAR(64) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_xianyu_buyer_user_id (buyer_user_id),
    KEY idx_xianyu_buyer_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xianyu_conversation (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    version BIGINT NULL,
    chat_id VARCHAR(128) NOT NULL,
    seller_user_id VARCHAR(128) NULL,
    buyer_user_id VARCHAR(128) NULL,
    item_id VARCHAR(128) NULL,
    latest_quote_no VARCHAR(64) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_xianyu_conversation_chat_id (chat_id),
    KEY idx_xianyu_conversation_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xianyu_delivery_record (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    platform_order_id VARCHAR(128) NOT NULL,
    local_order_no VARCHAR(64) NULL,
    success BIT NOT NULL,
    channel VARCHAR(64) NULL,
    error_message VARCHAR(1024) NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_xianyu_delivery_record_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xianyu_message (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    chat_id VARCHAR(128) NOT NULL,
    message_id VARCHAR(128) NOT NULL,
    sender_user_id VARCHAR(128) NULL,
    quote_no VARCHAR(64) NULL,
    message_type VARCHAR(64) NULL,
    raw_payload LONGTEXT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_xianyu_message_chat_message (chat_id, message_id),
    KEY idx_xianyu_message_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xianyu_platform_order (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    version BIGINT NULL,
    platform_order_id VARCHAR(128) NOT NULL,
    trade_no VARCHAR(128) NULL,
    chat_id VARCHAR(128) NOT NULL,
    buyer_user_id VARCHAR(128) NULL,
    seller_user_id VARCHAR(128) NULL,
    item_id VARCHAR(128) NULL,
    quote_no VARCHAR(64) NULL,
    local_order_no VARCHAR(64) NULL,
    paid_amount DECIMAL(12, 2) NULL,
    quoted_amount DECIMAL(12, 2) NULL,
    status VARCHAR(32) NOT NULL,
    last_error VARCHAR(1024) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    paid_at DATETIME(6) NULL,
    delivery_claimed_at DATETIME(6) NULL,
    delivered_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_xianyu_platform_order_platform_order_id (platform_order_id),
    KEY idx_xianyu_platform_order_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xianyu_reply_config (
    config_key VARCHAR(64) NOT NULL,
    user_id BIGINT NULL,
    templates_json LONGTEXT NULL,
    keyword_rules_json LONGTEXT NULL,
    text_fallback_enabled BIT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (config_key),
    KEY idx_xianyu_reply_config_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS xianyu_seller_account (
    id BIGINT NOT NULL AUTO_INCREMENT,
    user_id BIGINT NULL,
    seller_user_id VARCHAR(128) NOT NULL,
    nickname VARCHAR(128) NULL,
    active BIT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_xianyu_seller_account_seller_user_id (seller_user_id),
    KEY idx_xianyu_seller_account_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
