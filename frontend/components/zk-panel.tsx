"use client"

// The ZK proof panel — the hackathon hero. Shows the zero-knowledge story for an
// action: proving → public signals → verified on-chain by the Soroban verifier →
// pairing check → nullifier spent. Rendered inline on every action page.
import { ShieldCheck, Cpu, Link2 } from "lucide-react"

export type ZkState = {
  circuit?: string // e.g. "withdraw_public"
  verifier?: string // on-chain verifier contract id
  proving?: boolean
  verifiedOnChain?: boolean
  txHash?: string // the on-chain verify/settle tx
  nullifier?: string
  publicSignals?: { label: string; value: string }[]
}

const EXPLORER = "https://stellar.expert/explorer/testnet/tx/"

export function ZkPanel({ state }: { state: ZkState }) {
  const { circuit, verifier, proving, verifiedOnChain, txHash, nullifier, publicSignals } = state
  return (
    <div className="rounded-lg border border-[#2563eb]/25 bg-black/40 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <ShieldCheck className="h-3.5 w-3.5 text-[#2563eb]" />
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Zero-Knowledge Proof{circuit ? ` · ${circuit}` : ""}
        </span>
      </div>
      <div className="space-y-3 p-4 font-mono text-xs">
        <Row icon={<Cpu className="h-3.5 w-3.5" />} label="Groth16 / BLS12-381">
          {proving ? <span className="text-[#2563eb]">generating proof…</span>
            : verifiedOnChain ? <span className="text-emerald-400">proof generated + verified</span>
            : <span className="text-muted-foreground">idle</span>}
        </Row>

        {publicSignals && publicSignals.length > 0 && (
          <div className="rounded border border-border bg-black/30 p-2">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">public signals</p>
            {publicSignals.map((s, i) => (
              <div key={i} className="flex justify-between gap-4 py-0.5">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="truncate text-foreground/80">{s.value}</span>
              </div>
            ))}
          </div>
        )}

        <Row icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Verified on-chain">
          {verifiedOnChain
            ? <span className="text-emerald-400">pairing_check passed{verifier ? ` · ${short(verifier)}` : ""}</span>
            : <span className="text-muted-foreground">pending</span>}
        </Row>

        {nullifier && (
          <Row icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Nullifier spent">
            <span className="truncate text-foreground/80">{short(nullifier)}</span>
          </Row>
        )}

        {txHash && (
          <a href={`${EXPLORER}${txHash}`} target="_blank" rel="noreferrer"
             className="flex items-center gap-2 text-[#2563eb] hover:underline">
            <Link2 className="h-3.5 w-3.5" /> {short(txHash)} — view on explorer
          </a>
        )}
      </div>
    </div>
  )
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-muted-foreground">{icon}{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function short(s: string): string {
  if (!s) return ""
  const h = s.startsWith("0x") ? s : s
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h
}
