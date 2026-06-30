import pg from "pg";
import nacl from "tweetnacl";
import { type CommitteeNodeKeyPair } from "@shade/mpc-crypto";

type KeyRow = {
  node_id: string;
  encryption_pubkey: string;
  encryption_secret: string;
  signing_pubkey: string;
  signing_secret: string;
};

function rowToKeyPair(row: KeyRow): CommitteeNodeKeyPair {
  return {
    nodeId: row.node_id,
    encryptionKeyPair: {
      publicKey: Buffer.from(row.encryption_pubkey, "hex"),
      secretKey: Buffer.from(row.encryption_secret, "hex")
    } as nacl.BoxKeyPair,
    signingKeyPair: {
      publicKey: Buffer.from(row.signing_pubkey, "hex"),
      secretKey: Buffer.from(row.signing_secret, "hex")
    } as nacl.SignKeyPair
  };
}

function keyPairToRow(kp: CommitteeNodeKeyPair): Omit<KeyRow, never> {
  return {
    node_id: kp.nodeId,
    encryption_pubkey: Buffer.from(kp.encryptionKeyPair.publicKey).toString("hex"),
    encryption_secret: Buffer.from(kp.encryptionKeyPair.secretKey).toString("hex"),
    signing_pubkey: Buffer.from(kp.signingKeyPair.publicKey).toString("hex"),
    signing_secret: Buffer.from(kp.signingKeyPair.secretKey).toString("hex")
  };
}

// Load committee keypairs from DB, or generate and persist them if not found.
// This ensures keypairs survive process restarts so signed batches remain verifiable.
export async function loadOrGenerateKeys(
  dbUrl: string,
  nodeIds: readonly string[]
): Promise<CommitteeNodeKeyPair[]> {
  const pool = new pg.Pool({ connectionString: dbUrl });
  try {
    // Ensure table exists (idempotent — migration 008 should have run, but be safe).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mpc_committee_keys (
        node_id             TEXT        PRIMARY KEY,
        encryption_pubkey   TEXT        NOT NULL,
        encryption_secret   TEXT        NOT NULL,
        signing_pubkey      TEXT        NOT NULL,
        signing_secret      TEXT        NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await pool.query<KeyRow>(
      "SELECT * FROM mpc_committee_keys WHERE node_id = ANY($1) ORDER BY node_id",
      [nodeIds as string[]]
    );

    if (rows.length === nodeIds.length) {
      const byId = new Map(rows.map(r => [r.node_id, r]));
      console.log("[mpc-keys] loaded persistent committee keypairs from DB");
      return nodeIds.map(id => rowToKeyPair(byId.get(id)!));
    }

    // Generate fresh keys for any nodes not yet in DB.
    const existing = new Map(rows.map(r => [r.node_id, rowToKeyPair(r)]));
    const keypairs: CommitteeNodeKeyPair[] = [];

    for (const id of nodeIds) {
      if (existing.has(id)) {
        keypairs.push(existing.get(id)!);
        continue;
      }
      const kp: CommitteeNodeKeyPair = {
        nodeId: id,
        encryptionKeyPair: nacl.box.keyPair(),
        signingKeyPair: nacl.sign.keyPair()
      };
      const row = keyPairToRow(kp);
      await pool.query(
        `INSERT INTO mpc_committee_keys
           (node_id, encryption_pubkey, encryption_secret, signing_pubkey, signing_secret)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (node_id) DO NOTHING`,
        [row.node_id, row.encryption_pubkey, row.encryption_secret, row.signing_pubkey, row.signing_secret]
      );
      keypairs.push(kp);
    }

    console.log("[mpc-keys] generated and persisted new committee keypairs");
    return keypairs;
  } finally {
    await pool.end();
  }
}
