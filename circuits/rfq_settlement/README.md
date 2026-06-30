# RFQSettlement Circuit

Status: **implemented** — embedded in `circuits/withdraw_public/main.circom`.

The `withdraw_public` circuit handles RFQ settlement via `operationType = RFQ_SETTLE` and the following public signals:
- `quoteHash` [10] — `int(sha256(quote)[:31])`; the pool enforces `arg.quote_hash == proof.quoteHash`
- `intentHash` [11] — `int(sha256(intent)[:31])`; the pool enforces `arg.intent_hash == proof.intentHash`
- `fillReceiptHash` [12] — `int(sha256(fill_tx)[:31])`; binds the real on-chain fill transaction

Solver signature verification is handled in the Soroban contract (off-circuit), which matches the design note. The quote hash is bound into the ZK proof, so the solver cannot forge a quote.

No separate `rfq_settlement.circom` is needed.
