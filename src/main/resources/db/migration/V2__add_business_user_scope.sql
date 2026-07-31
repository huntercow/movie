DELIMITER $$

CREATE PROCEDURE add_user_scope_column(IN table_name_value VARCHAR(64))
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = table_name_value
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = table_name_value
          AND column_name = 'user_id'
    ) THEN
        SET @alter_sql = CONCAT(
            'ALTER TABLE `', table_name_value,
            '` ADD COLUMN user_id BIGINT NULL, ADD INDEX `idx_',
            table_name_value, '_user` (user_id)'
        );
        PREPARE alter_statement FROM @alter_sql;
        EXECUTE alter_statement;
        DEALLOCATE PREPARE alter_statement;
    END IF;
END$$

DELIMITER ;

CALL add_user_scope_column('bot_message');
CALL add_user_scope_column('customer');
CALL add_user_scope_column('payment_record');
CALL add_user_scope_column('ticket_order');
CALL add_user_scope_column('ticket_quote');
CALL add_user_scope_column('xianyu_buyer');
CALL add_user_scope_column('xianyu_conversation');
CALL add_user_scope_column('xianyu_delivery_record');
CALL add_user_scope_column('xianyu_message');
CALL add_user_scope_column('xianyu_platform_order');
CALL add_user_scope_column('xianyu_reply_config');
CALL add_user_scope_column('xianyu_seller_account');

DROP PROCEDURE add_user_scope_column;
