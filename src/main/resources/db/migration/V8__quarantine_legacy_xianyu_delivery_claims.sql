UPDATE xianyu_platform_order
SET status = 'NEED_MANUAL',
    last_error = 'LEGACY_DELIVERY_CLAIM_OUTCOME_UNKNOWN',
    delivery_claimed_at = NULL,
    updated_at = NOW(6)
WHERE status = 'ISSUED_WAIT_DELIVER'
  AND delivery_claimed_at IS NOT NULL
  AND delivery_attempt_id IS NULL;
