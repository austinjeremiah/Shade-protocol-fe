import pg from "pg";
import { JobQueue } from "@shade/queue";

// MPC Settler: polls mpc_batches for signed matches that haven't been submitted
// to the settlement layer yet, queues MPC_SETTLE_SUBMIT relayer jobs with full
// note data (nullifiers + output commitments) fetched from mpc_intents.

type MatchRow = {
  intentAId: string;
  intentBId: string;
  matchedAmount7dp: string;
  inputAsset: string;
  outputAsset: string;
};

type BatchRow = {
  batch_id: string;
  session_id: string;
  batch_hash: string;
  matches_json: MatchRow[];
  signatures_json: Array<{ nodeId: string; signingPubkey: string; signature: string }>;
  settlement_status: string;
};

type IntentRow = {
  intent_id: string;
  note_nullifier: string;
  note_commitment: string;
  recipient_commitment: string;
};

// Fetch nullifier + commitments for an intent from the DB.
async function fetchIntentNote(pool: pg.Pool, intentId: string): Promise<IntentRow | null> {
  const { rows } = await pool.query<IntentRow>(
    `SELECT intent_id, note_nullifier, note_commitment, recipient_commitment
     FROM mpc_intents WHERE intent_id = $1`,
    [intentId]
  );
  return rows[0] ?? null;
}

// One MPC_SETTLE_SUBMIT job per match in a batch.
// Includes full note data so the relayer can construct the on-chain call.
async function queueSettlementJobs(queue: JobQueue, pool: pg.Pool, batch: BatchRow): Promise<void> {
  const matches: MatchRow[] = Array.isArray(batch.matches_json)
    ? batch.matches_json
    : (batch.matches_json as unknown as string[]).map(s => JSON.parse(String(s)));

  const sigs = Array.isArray(batch.signatures_json)
    ? batch.signatures_json
    : (batch.signatures_json as unknown as string[]).map(s => JSON.parse(String(s)));

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const idempotencyKey = `mpc_settle:${batch.batch_id}:${i}`;

    // Fetch note data for both sides of the match.
    const [noteA, noteB] = await Promise.all([
      fetchIntentNote(pool, m.intentAId),
      fetchIntentNote(pool, m.intentBId)
    ]);

    await queue.enqueue(
      "relayer",
      "MPC_SETTLE_SUBMIT",
      {
        batchId: batch.batch_id,
        batchHash: batch.batch_hash,
        signatures: sigs,
        matchIndex: i,
        sessionId: batch.session_id,
        intentAId: m.intentAId,
        intentBId: m.intentBId,
        matchedAmount7dp: m.matchedAmount7dp,
        inputAsset: m.inputAsset,
        outputAsset: m.outputAsset,
        // Note data for on-chain settlement call
        nullifierA: noteA?.note_nullifier ?? null,
        nullifierB: noteB?.note_nullifier ?? null,
        // recipientCommitment = the new output note the counterparty will own
        outputCommitmentA: noteA?.recipient_commitment ?? null,
        outputCommitmentB: noteB?.recipient_commitment ?? null,
      },
      idempotencyKey
    );
  }

  await pool.query(
    "UPDATE mpc_batches SET settlement_status='queued', updated_at=now() WHERE batch_id=$1",
    [batch.batch_id]
  );
  console.log(`[settler] batch ${batch.batch_id}: ${matches.length} match(es) queued for settlement`);
}

// Poll once for pending signed batches and dispatch settlement jobs.
export async function settleOnce(queue: JobQueue, pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<BatchRow>(
    `SELECT batch_id, session_id, batch_hash, matches_json, signatures_json, settlement_status
     FROM mpc_batches
     WHERE settlement_status = 'pending'
     ORDER BY created_at ASC
     LIMIT 50`
  );
  for (const batch of rows) {
    await queueSettlementJobs(queue, pool, batch);
  }
  return rows.length;
}

// Long-running settler loop. Runs alongside the committee service.
export async function runSettlerLoop(
  dbUrl: string,
  intervalMs = 10_000
): Promise<void> {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: dbUrl });
  const queue = new JobQueue(dbUrl);

  console.log(`[settler] starting — polling every ${intervalMs}ms for signed MPC batches`);
  for (;;) {
    try {
      const n = await settleOnce(queue, pool);
      if (n > 0) console.log(`[settler] dispatched settlement jobs for ${n} batch(es)`);
    } catch (err) {
      console.error("[settler] error in settle loop:", err);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
