import "dotenv/config";
import Fastify from "fastify";
import { v4 as uuidv4 } from "uuid";
import {
  generateNodeKeyPair, nodePublicInfo,
  decryptShare, verifySignedBatch,
  type MpcIntent, type EncryptedShare
} from "@shade/mpc-crypto";
import { CommitteeState } from "./state.js";
import { runMatchingRound } from "./coordinator.js";
import { runSettlerLoop } from "./settler.js";
import { loadOrGenerateKeys } from "./keys.js";

// Three committee nodes run in the same process (simulating a distributed committee).
// Each node has its own key pair. In production they'd be separate services.
const NODE_IDS = ["node-1", "node-2", "node-3"] as const;
const NODE_PORTS = { "node-1": 8091, "node-2": 8092, "node-3": 8093 } as const;
const COORDINATOR_PORT = 8090;
const BATCH_WINDOW_MS = Number(process.env.MPC_BATCH_WINDOW_MS ?? 30_000); // 30 s default

// Load keypairs from DB if available; otherwise generate ephemeral ones (no-DB mode).
const dbUrl = process.env.DATABASE_URL;
const nodes = dbUrl
  ? await loadOrGenerateKeys(dbUrl, NODE_IDS)
  : NODE_IDS.map(id => generateNodeKeyPair(id));

const nodeMap = new Map(nodes.map(n => [n.nodeId, n]));
const committeeInfo = nodes.map(nodePublicInfo);

const state = new CommitteeState();

// -------- Per-node Fastify instances --------
// Each exposes: GET /info, POST /shares/:intentId, POST /sign-batch

async function startNode(nodeIndex: number) {
  const node = nodes[nodeIndex];
  const port = NODE_PORTS[node.nodeId as keyof typeof NODE_PORTS];
  const app = Fastify({ logger: false });

  // Node public identity (encryption + signing pubkeys).
  app.get("/info", async () => nodePublicInfo(node));

  // Receive an encrypted share for an intent.
  app.post<{ Params: { intentId: string }; Body: EncryptedShare }>(
    "/shares/:intentId",
    async (request, reply) => {
      const { intentId } = request.params;
      const encShare = request.body as EncryptedShare;
      if (encShare.nodeId !== node.nodeId) {
        reply.code(400);
        return { error: "share addressed to wrong node" };
      }
      const session = state.getSessionForIntent(intentId);
      if (!session) {
        reply.code(404);
        return { error: "intent not registered" };
      }
      const nodeShares = session.shares.get(node.nodeId);
      if (!nodeShares?.has(intentId)) {
        reply.code(404);
        return { error: "share slot not found for this intent" };
      }
      // Store the encrypted share (overwrite with confirmed delivery).
      nodeShares.get(intentId)!.encryptedShare = {
        ciphertext: encShare.ciphertext,
        nonce: encShare.nonce,
        senderPubkey: encShare.senderPubkey
      };
      return { ok: true, nodeId: node.nodeId, intentId };
    }
  );

  // Decrypt and return this node's share for a specific intent (coordinator only).
  app.post<{ Params: { intentId: string } }>(
    "/decrypt-share/:intentId",
    async (request, reply) => {
      const { intentId } = request.params;
      const session = state.getSessionForIntent(intentId);
      if (!session) { reply.code(404); return { error: "intent not found" }; }
      const entry = session.shares.get(node.nodeId)?.get(intentId);
      if (!entry) { reply.code(404); return { error: "share not found" }; }
      try {
        const decrypted = decryptShare(
          { ...entry.encryptedShare, nodeId: node.nodeId },
          node.encryptionKeyPair.secretKey
        );
        return { ok: true, share: decrypted };
      } catch (err) {
        reply.code(422);
        return { error: String(err) };
      }
    }
  );

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`[mpc] node ${node.nodeId} listening on :${port}`);
}

// -------- Coordinator Fastify instance --------

async function startCoordinator() {
  const app = Fastify({ logger: { level: "info" } });

  // Committee info: all 3 node pubkeys.
  app.get("/v1/mpc/committee", async () => ({ nodes: committeeInfo }));

  // Submit an MPC intent (with encrypted shares for each node).
  app.post<{ Body: { intent: MpcIntent } }>(
    "/v1/mpc/intents",
    async (request, reply) => {
      const { intent } = request.body;
      if (!intent?.intentId) { reply.code(400); return { error: "intentId required" }; }
      if (intent.encryptedShares.length !== nodes.length) {
        reply.code(400);
        return { error: `must supply ${nodes.length} encrypted shares, one per committee node` };
      }
      const sessionId = state.addIntent(intent);
      return { ok: true, intentId: intent.intentId, sessionId };
    }
  );

  // Session status.
  app.get<{ Params: { sessionId: string } }>(
    "/v1/mpc/sessions/:sessionId",
    async (request, reply) => {
      const session = state.getSession(request.params.sessionId);
      if (!session) { reply.code(404); return { error: "session not found" }; }
      return {
        sessionId: session.sessionId,
        status: session.status,
        intentCount: session.intents.size,
        startedAt: session.startedAt,
        signedBatch: session.signedBatch ?? null
      };
    }
  );

  // Manually trigger a matching round (for demo/testing; production uses the timer).
  app.post<{ Params: { sessionId: string } }>(
    "/v1/mpc/sessions/:sessionId/match",
    async (request, reply) => {
      const session = state.getSession(request.params.sessionId);
      if (!session) { reply.code(404); return { error: "session not found" }; }
      if (session.status !== "open") {
        return { ok: false, reason: `session already in status '${session.status}'` };
      }
      const result = await runMatchingRound(session, nodes);
      return result.ok
        ? { ok: true, batch: result.batch }
        : { ok: false, reason: result.reason };
    }
  );

  // All signed batches (for polling by the API/settlement layer).
  app.get("/v1/mpc/batches", async () => {
    const signed = state.allSessions()
      .filter(s => s.status === "signed" && s.signedBatch)
      .map(s => s.signedBatch!);
    return { batches: signed };
  });

  // Verify a signed batch externally.
  app.post<{ Body: { batch: import("@shade/mpc-crypto").SignedMatchBatch } }>(
    "/v1/mpc/verify",
    async (request, reply) => {
      const { batch } = request.body;
      if (!batch) { reply.code(400); return { error: "batch required" }; }
      const valid = verifySignedBatch(batch, committeeInfo);
      return { valid, nodeCount: committeeInfo.length, sigCount: batch.signatures.length };
    }
  );

  // Health.
  app.get("/health", async () => ({
    ok: true,
    service: "mpc-committee",
    nodes: NODE_IDS,
    batchWindowMs: BATCH_WINDOW_MS
  }));

  await app.listen({ port: COORDINATOR_PORT, host: "0.0.0.0" });
  console.log(`[mpc] coordinator listening on :${COORDINATOR_PORT}`);
}

// -------- Auto-batch timer --------
// Every BATCH_WINDOW_MS, close any open sessions with ≥2 intents and run matching.

function startBatchTimer() {
  setInterval(async () => {
    const open = state.getOpenSessions();
    for (const session of open) {
      if (session.intents.size < 2) continue;
      console.log(`[mpc] auto-matching session ${session.sessionId} with ${session.intents.size} intents`);
      const result = await runMatchingRound(session, nodes);
      if (result.ok) {
        console.log(`[mpc] batch ${result.batch.batchId}: ${result.batch.matches.length} matches, signed by ${result.batch.signatures.length} nodes`);
      } else {
        console.warn(`[mpc] matching failed for ${session.sessionId}: ${result.reason}`);
      }
    }
  }, BATCH_WINDOW_MS);
}

// -------- Boot --------
await Promise.all([
  startCoordinator(),
  ...nodes.map((_, i) => startNode(i))
]);

startBatchTimer();
console.log("[mpc] committee running. coordinator=:8090 nodes=:8091-8093");

// Settler runs only when the DB is configured (not during unit tests / mpc:e2e demo).
if (dbUrl) {
  const SETTLER_INTERVAL_MS = Number(process.env.MPC_SETTLER_INTERVAL_MS ?? 10_000);
  runSettlerLoop(dbUrl, SETTLER_INTERVAL_MS).catch(err => {
    console.error("[mpc] settler crashed:", err);
  });
} else {
  console.log("[mpc] DATABASE_URL not set — settler disabled (in-memory only mode)");
}
