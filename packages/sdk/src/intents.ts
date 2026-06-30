// IntentClient — submits private RFQ intents to the Shade API and tracks lifecycle.
// Uses fetch (browser-native). Pass an authToken from Privy for authenticated routes.

export type IntentParams = {
  inputAsset: string;          // "USDC:Stellar:SAC"
  outputAsset: string;         // "USDC:ArbitrumSepolia"
  amountMode: "exact_in" | "exact_out" | "max_in";
  amount7dp: string;           // input amount in 7dp
  minOutput7dp: string;        // minimum acceptable output in 7dp
  expiryLedger: number;        // Stellar ledger sequence after which intent is void
  noteCommitment: string;      // 0x.. Poseidon commitment of the deposited input note
  destination: string;         // EVM address for Path A payout
  policyId?: string;
};

export type QuoteResult = {
  quoteId: string;
  solverPubkey: string;
  netOutput7dp: string;        // net payout to the user in 7dp
  fee7dp: string;
  validUntilLedger: number;
  settlementMethod: string;
};

export type SettlementStatus = {
  state: "pending" | "filled" | "settled" | "expired" | "failed";
  txHash?: string;
  detail?: string;
};

export type DepositStatus = {
  state: "pending" | "attesting" | "forwarded" | "registered" | "failed";
  leafIndex?: number;
  root?: string;
  burnTxHash?: string;
  stellarTxHash?: string;
};

export class IntentClient {
  constructor(
    private readonly apiBase: string,
    private readonly authToken?: string
  ) {}

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {})
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, { headers: this.headers });
    if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  // Submit a private RFQ intent. Returns intentId + intentHash for subsequent calls.
  async submit(p: IntentParams): Promise<{ intentId: string; intentHash: string }> {
    return this.post("/v1/intents", {
      intent_type: "PRIVATE_RFQ",
      version: "1.0",
      user_pubkey_commitment: p.noteCommitment,
      input_asset: p.inputAsset,
      output_asset: p.outputAsset,
      amount_mode: p.amountMode,
      amount: p.amount7dp,
      min_output: p.minOutput7dp,
      expiry_ledger: p.expiryLedger,
      allowed_solvers_root: "0x" + "00".repeat(32),
      compliance_policy_id: p.policyId ?? "shade:default-testnet-policy:v1",
      destination: p.destination,
      replay_domain: "shade:stellar:testnet:rfq:v1"
    });
  }

  // Poll for a solver quote until one arrives or the timeout expires.
  async pollQuote(
    intentId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<QuoteResult> {
    const { timeoutMs = 60_000, intervalMs = 2_000 } = opts;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const data = await this.get<{ quotes?: QuoteResult[] }>(`/v1/intents/${intentId}/quotes`);
        if (data.quotes?.[0]) return data.quotes[0];
      } catch { /* not ready yet */ }
      await delay(intervalMs);
    }
    throw new Error(`pollQuote: no quote after ${timeoutMs}ms for intent ${intentId}`);
  }

  async acceptQuote(quoteId: string): Promise<{ accepted: boolean }> {
    return this.post(`/v1/quotes/${quoteId}/accept`, {});
  }

  // Poll intent state until settled/failed/expired or timeout.
  async trackSettlement(
    intentId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<SettlementStatus> {
    const { timeoutMs = 300_000, intervalMs = 5_000 } = opts;
    const deadline = Date.now() + timeoutMs;
    const terminal = new Set(["settled", "failed", "expired"]);
    while (Date.now() < deadline) {
      try {
        const data = await this.get<{ state?: string; tx_hash?: string }>(`/v1/intents/${intentId}`);
        if (data.state && terminal.has(data.state)) {
          return { state: data.state as SettlementStatus["state"], txHash: data.tx_hash };
        }
      } catch { /* transient */ }
      await delay(intervalMs);
    }
    return { state: "pending", detail: `not settled after ${timeoutMs}ms` };
  }

  // Poll a CCTP deposit job until the note is registered in the pool.
  async trackDeposit(
    depositId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<DepositStatus> {
    const { timeoutMs = 600_000, intervalMs = 8_000 } = opts;
    const deadline = Date.now() + timeoutMs;
    const terminal = new Set(["registered", "failed"]);
    while (Date.now() < deadline) {
      try {
        const data = await this.get<DepositStatus>(`/v1/deposits/${depositId}`);
        if (data.state && terminal.has(data.state)) return data;
      } catch { /* transient */ }
      await delay(intervalMs);
    }
    return { state: "pending" };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
