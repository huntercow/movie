UPDATE agent_token
SET status = 'PENDING'
WHERE expires_at IS NULL
  AND status IN ('UNUSED', 'ACTIVE');
