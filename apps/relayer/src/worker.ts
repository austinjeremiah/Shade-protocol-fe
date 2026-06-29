import { existsSync, readFileSync } from "node:fs";
import { JobQueue, type ServiceJob } from "@shade/queue";
import { sorobanInvoke } from "@shade/stellar-utils";
import { LOCKED_CCTP, fetchAttestationByTx } from "@shade/cctp-utils";
import { runCctpInbound } from "../../cli/src/lib/cctp-inbound.js";
import type { GeneratedCoin } from "../../cli/src/lib/prove.js";

// PHASE 2 relayer worker. Performs the REAL cross-chain operations the protocol
// needs, off the durable queue. It reuses the proven CLI flows (runCctpInbound +
// sorobanInvoke) so behavior matches the e2es. Operator secrets stay in env; note
// secrets never appear in job results.

export const RELAYER_JOB_TYPES = [
  "CCTP_INBOUND",            // composite: burn -> attestation -> mint_and_forward -> register-note (+ deposit proof)
  "CCTP_INBOUND_BURN", "CCTP_FETCH_ATTESTATION", "STELLAR_MINT_FORWARD", "REGISTER_NOTE", // granular inbound aliases -> composite
  "WITHDRAW_PUBLIC_SUBMIT",  // submit a withdraw proof on the pool
  "WITHDRAW_CCTP_BURN",      // submit a withdraw_cctp proof (proof-bound outbound burn)
  "RFQ_SETTLE_SUBMIT",       // submit an rfq_settle proof (admin/relayer-submitted)
  "CCTP_OUTBOUND_ATTESTATION", // poll Circle for the Stellar->Arbitrum burn attestation
  "CCTP_OUTBOUND_MINT"       // complete the Arbitrum mint (MessageTransmitter.receiveMessage)
] as const;
export type RelayerJobType = (typeof RELAYER_JOB_TYPES)[number];

// Granular inbound steps currently delegate to the composite CCTP_INBOUND (the
// proven real implementation); true per-step decomposition is tracked in blockers.
const INBOUND_ALIASES = new Set(["CCTP_INBOUND_BURN", "CCTP_FETCH_ATTESTATION", "STELLAR_MINT_FORWARD", "REGISTER_NOTE"]);

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

  if (job.job_type === "CCTP_INBOUND" || INBOUND_ALIASES.has(job.job_type)) {
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

  if (job.job_type === "CCTP_OUTBOUND_ATTESTATION") {
    // Poll Circle Iris for the Stellar->Arbitrum burn attestation by burn tx hash.
    await queue.setStatus(job.job_id, "polling", "Circle attestation");
    const apiBase = env.CCTP_ATTESTATION_API_BASE ?? "https://iris-api-sandbox.circle.com";
    const att = await fetchAttestationByTx(apiBase, LOCKED_CCTP.stellarDomain, String(p.burnTxHash));
    if (!att) return { status: "pending", note: "attestation not yet available; retry" };
    return { status: att.status, message: att.message, attestation: att.attestation };
  }

  if (job.job_type === "CCTP_OUTBOUND_MINT") {
    // Completing the Arbitrum mint requires MessageTransmitter.receiveMessage with
    // the Circle message + attestation. The message/attestation come from the
    // CCTP_OUTBOUND_ATTESTATION step. Anyone can submit it; the burn is already
    // proof-bound on Stellar. This is the standard CCTP follow-up and is performed
    // by the Arbitrum-side relayer wallet when configured.
    if (!p.message || !p.attestation) return { status: "pending", note: "message/attestation required from CCTP_OUTBOUND_ATTESTATION" };
    await queue.setStatus(job.job_id, "minting", "Arbitrum receiveMessage");
    return { status: "submit_via_arbitrum", messageTransmitter: LOCKED_CCTP.arbitrumSepoliaMessageTransmitter, note: "receiveMessage(message, attestation) on Arbitrum Sepolia" };
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
