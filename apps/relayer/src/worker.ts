import { existsSync, readFileSync } from "node:fs";
import { JobQueue, type ServiceJob } from "@shade/queue";
import { sorobanInvoke } from "@shade/stellar-utils";
import { runCctpInbound } from "../../cli/src/lib/cctp-inbound.js";
import type { GeneratedCoin } from "../../cli/src/lib/prove.js";

// PHASE 2 relayer worker. Performs the REAL cross-chain operations the protocol
// needs, off the durable queue. It reuses the proven CLI flows (runCctpInbound +
// sorobanInvoke) so behavior matches the e2es. Operator secrets stay in env; note
// secrets never appear in job results.

export const RELAYER_JOB_TYPES = [
  "CCTP_INBOUND",            // composite: burn -> attestation -> mint_and_forward -> register-note (+ deposit proof)
  "WITHDRAW_PUBLIC_SUBMIT",  // submit a withdraw proof on the pool
  "WITHDRAW_CCTP_BURN",      // submit a withdraw_cctp proof (proof-bound outbound burn)
  "RFQ_SETTLE_SUBMIT"        // submit an rfq_settle proof (admin/relayer-submitted)
] as const;
export type RelayerJobType = (typeof RELAYER_JOB_TYPES)[number];

type EnvMap = Record<string, string>;
function parseEnvFile(env: EnvMap, path: string, override: boolean): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i);
    if (override || env[k] === undefined) env[k] = line.slice(i + 1);
  }
}
// Mirror the CLI's loadRuntimeEnv: process.env wins for plain .env values, but
// .env.generated (contract IDs) is authoritative and always overrides. The user
// wallet keys (ETH_PRIVATE_KEY etc.) live in the repo-parent .env.
function loadEnv(): EnvMap {
  const env: EnvMap = { ...process.env } as EnvMap;
  parseEnvFile(env, "../.env", false);
  parseEnvFile(env, ".env", false);
  parseEnvFile(env, ".env.generated", true);
  return env;
}

function coinFromPath(path: string): GeneratedCoin {
  const c = JSON.parse(readFileSync(path, "utf8"));
  return { path, commitmentHex: c.commitment_hex, commitmentDecimal: c.coin.commitment, value7dp: c.coin.value };
}

const RPC = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const PASS = process.env.STELLAR_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

export async function processRelayerJob(queue: JobQueue, job: ServiceJob): Promise<Record<string, unknown>> {
  const env = loadEnv();
  const p = job.payload as Record<string, unknown>;
  const pool = (p.pool as string) ?? env.SHIELDED_POOL_CONTRACT;
  const relayerSecret = env.STELLAR_RELAYER_SECRET;
  if (!pool || !relayerSecret) throw new Error("relayer missing SHIELDED_POOL_CONTRACT / STELLAR_RELAYER_SECRET");

  if (job.job_type === "CCTP_INBOUND") {
    await queue.setStatus(job.job_id, "burning", "CCTP burn + attestation + mint_and_forward + register");
    const result = await runCctpInbound(env, {
      amount6: BigInt(String(p.amount6 ?? "1000000")),
      commitmentHex: String(p.commitmentHex),
      encryptedNotePayloadHashHex: String(p.encryptedNotePayloadHashHex),
      policyIdHex: String(p.policyIdHex),
      fast: true,
      targetContract: pool,
      newRootHex: String(p.newRootHex),
      coin: coinFromPath(String(p.coinPath)),
      scratch: process.env.SHADE_SCRATCH_DIR
    });
    return { burnTxHash: result.burnTxHash, mintForwardTxHash: result.mintForwardTxHash, leafIndex: result.leafIndex, root: result.root, amount7: result.amount7 };
  }

  if (job.job_type === "WITHDRAW_PUBLIC_SUBMIT") {
    // `to` must authorize the withdraw (note owner). In the testnet harness the
    // recipient's secret is an operator-managed test wallet.
    const secret = (p.toSecret as string) ?? env.STELLAR_USER_SECRET;
    await queue.setStatus(job.job_id, "submitting", "pool.withdraw");
    const r = sorobanInvoke({ contractId: pool, secret, method: "withdraw", rpcUrl: RPC, passphrase: PASS, retries: 3,
      args: ["--to", String(p.to), "--proof_bytes", String(p.proofHex), "--pub_signals_bytes", String(p.publicHex)] });
    return { txHash: r.txHash };
  }

  if (job.job_type === "WITHDRAW_CCTP_BURN") {
    const secret = (p.toSecret as string) ?? env.STELLAR_USER_SECRET;
    await queue.setStatus(job.job_id, "submitting", "pool.withdraw_cctp");
    const r = sorobanInvoke({ contractId: pool, secret, method: "withdraw_cctp", rpcUrl: RPC, passphrase: PASS, retries: 3,
      args: ["--to", String(p.to), "--proof_bytes", String(p.proofHex), "--pub_signals_bytes", String(p.publicHex),
        "--destination_domain", String(p.destinationDomain), "--destination_recipient", String(p.destinationRecipient),
        "--max_fee", String(p.maxFee), "--min_finality_threshold", String(p.minFinalityThreshold)] });
    return { txHash: r.txHash };
  }

  if (job.job_type === "RFQ_SETTLE_SUBMIT") {
    await queue.setStatus(job.job_id, "submitting", "pool.rfq_settle");
    const r = sorobanInvoke({ contractId: pool, secret: relayerSecret, method: "rfq_settle", rpcUrl: RPC, passphrase: PASS, retries: 3,
      args: ["--to_solver", String(p.toSolver), "--proof_bytes", String(p.proofHex), "--pub_signals_bytes", String(p.publicHex),
        "--quote_hash", String(p.quoteHash), "--intent_hash", String(p.intentHash), "--fill_receipt_hash", String(p.fillReceiptHash),
        "--solver_pubkey", String(p.solverPubkey), "--solver_sig", String(p.solverSig)] });
    return { txHash: r.txHash };
  }

  throw new Error(`unknown relayer job type ${job.job_type}`);
}

export async function runRelayerOnce(queue: JobQueue): Promise<boolean> {
  const job = await queue.claimNext("relayer", [...RELAYER_JOB_TYPES]);
  if (!job) return false;
  try {
    const result = await processRelayerJob(queue, job);
    await queue.complete(job.job_id, result, "ready");
  } catch (e) {
    await queue.fail(job.job_id, (e as Error).message);
  }
  return true;
}

export async function runRelayerLoop(queue: JobQueue, intervalMs = 3000): Promise<void> {
  for (;;) {
    const did = await runRelayerOnce(queue);
    if (!did) await new Promise((r) => setTimeout(r, intervalMs));
  }
}
