-- MPC committee node keypairs (persistent across restarts).
-- encryption_secret / signing_secret are stored as hex. In production these
-- should be wrapped by a KMS or sealed env. For testnet they live in the DB.
CREATE TABLE IF NOT EXISTS mpc_committee_keys (
  node_id             TEXT        PRIMARY KEY,
  encryption_pubkey   TEXT        NOT NULL,
  encryption_secret   TEXT        NOT NULL,
  signing_pubkey      TEXT        NOT NULL,
  signing_secret      TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
