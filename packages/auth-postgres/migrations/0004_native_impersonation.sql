ALTER TABLE doxa_auth_sessions
  ADD COLUMN IF NOT EXISTS impersonated_identity_id text,
  ADD COLUMN IF NOT EXISTS impersonation_reason text,
  ADD COLUMN IF NOT EXISTS impersonation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS impersonation_expires_at timestamptz;

ALTER TABLE doxa_auth_sessions
  DROP CONSTRAINT IF EXISTS doxa_auth_session_impersonation_complete,
  ADD CONSTRAINT doxa_auth_session_impersonation_complete CHECK (
    (impersonated_identity_id IS NULL AND impersonation_reason IS NULL
      AND impersonation_started_at IS NULL AND impersonation_expires_at IS NULL)
    OR
    (impersonated_identity_id IS NOT NULL AND impersonation_reason IS NOT NULL
      AND impersonation_started_at IS NOT NULL AND impersonation_expires_at IS NOT NULL
      AND impersonated_identity_id <> identity_id
      AND char_length(btrim(impersonation_reason)) BETWEEN 1 AND 500
      AND impersonation_expires_at > impersonation_started_at
      AND impersonation_expires_at <= expires_at)
  );

CREATE INDEX IF NOT EXISTS doxa_auth_session_impersonation_expiry_idx
  ON doxa_auth_sessions (impersonation_expires_at)
  WHERE impersonated_identity_id IS NOT NULL AND revoked_at IS NULL;
