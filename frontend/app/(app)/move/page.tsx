"use client"

import { useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useMyNotes, useContracts, balanceUsdc, type NoteRow } from "@/lib/hooks"
import { LiveLog } from "@/components/live-log"
import { ZkPanel, type ZkState } from "@/components/zk-panel"
import { ArrowUpRight, Check, Loader2 } from "lucide-react"

type Tab = "withdraw" | "swap"

export default function MovePage() {
  const [tab, setTab] = useState<Tab>("withdraw")
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">Move</p>
        <h1 className="mt-2 font-sans text-4xl font-light tracking-tight" style={{ color: "#EDEAE3" }}>Spend your private notes</h1>
      </div>
      <div className="flex gap-2">
        <TabBtn active={tab === "withdraw"} onClick={() => setTab("withdraw")}>Withdraw</TabBtn>
        <TabBtn active={tab === "swap"} onClick={() => setTab("swap")}>Swap (RFQ)</TabBtn>
      </div>
      {tab === "withdraw" ? <Withdraw /> : (
        <div className="rounded-xl border border-border bg-black/30 p-8 text-center font-mono text-xs text-muted-foreground">
          Swap (RFQ) — coming next phase.
        </div>
      )}
    </div>
  )
}

function Withdraw() {
  const { authenticated } = usePrivy()
  const notes = useMyNotes(authenticated)
  const contracts = useContracts()
  const qc = useQueryClient()
  const active = (notes.data?.notes ?? []).filter((n) => n.status === "active")

  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState<string | undefined>()
  const [zk, setZk] = useState<ZkState>({ circuit: "withdraw_public" })
  const [error, setError] = useState<string | null>(null)
  const [doneTx, setDoneTx] = useState<string | null>(null)

  const commitment = selected ?? active[0]?.commitment ?? null

  async function run() {
    if (!commitment) return
    setBusy(true); setError(null); setJobId(undefined); setDoneTx(null)
    setZk({ circuit: "withdraw_public", verifier: contracts.data?.verifierWithdraw, proving: true, publicSignals: [{ label: "note", value: commitment }] })
    try {
      const res = await api.post<{ job_id: string }>("/v1/withdrawals/assist", { commitment })
      setJobId(res.job_id)
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const job = await api.get<{ status: string; result: Record<string, unknown> | null; error: string | null }>(`/v1/jobs/${res.job_id}`)
        if (job.status === "ready") {
          const tx = String(job.result?.txHash ?? "")
          setDoneTx(tx)
          setZk((z) => ({ ...z, proving: false, verifiedOnChain: true, txHash: tx, nullifier: commitment }))
          await qc.invalidateQueries({ queryKey: ["my-notes"] })
          await qc.invalidateQueries({ queryKey: ["activity"] })
          break
        }
        if (job.status === "failed") throw new Error(job.error ?? "withdraw failed")
      }
    } catch (e) {
      setError((e as { error?: string; message?: string }).error ?? (e as Error).message ?? "withdraw failed")
      setZk((z) => ({ ...z, proving: false }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-black/30 p-6">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Private note to spend</p>
        {active.length === 0 ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground">no active notes — <a href="/deposit" className="text-[#2563eb] hover:underline">shield some USDC first</a>.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {active.map((n) => (
              <button
                key={n.commitment}
                onClick={() => setSelected(n.commitment)}
                className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                  commitment === n.commitment ? "border-[#2563eb]/50 bg-[#2563eb]/5" : "border-border hover:border-border/80"
                }`}
              >
                <span className="font-mono text-xs text-foreground/70">{n.commitment.slice(0, 12)}…{n.commitment.slice(-6)}</span>
                <span className="font-sans text-lg font-light" style={{ color: "#EDEAE3" }}>{(Number(n.amount_usdc_7dp) / 1e7).toFixed(2)} <span className="text-xs text-muted-foreground">USDC</span></span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center gap-2 text-muted-foreground">
          <ArrowUpRight className="h-4 w-4 text-[#2563eb]" />
          <span className="font-mono text-xs">Releases USDC to your Stellar account (backend-assisted signing)</span>
        </div>

        <button
          onClick={run}
          disabled={busy || !commitment}
          className="mt-5 w-full rounded-full border border-[#2563eb]/40 bg-[#2563eb]/10 px-6 py-3 font-mono text-xs uppercase tracking-wider text-foreground transition-colors hover:bg-[#2563eb]/20 disabled:opacity-40"
        >
          {busy ? "Proving + releasing…" : "Withdraw note"}
        </button>
        {error && <p className="mt-3 font-mono text-xs text-red-400">error: {error}</p>}
        {doneTx && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/5 px-4 py-2.5 font-mono text-xs text-emerald-400">
            <Check className="h-3.5 w-3.5" /> Withdrawn · nullifier spent · USDC released
          </div>
        )}
      </div>

      {jobId && <LiveLog jobId={jobId} title="Prover + Stellar · withdraw_public ZK" />}
      {(jobId || busy) && <ZkPanel state={zk} />}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-5 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${
        active ? "border-[#2563eb]/50 bg-[#2563eb]/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}
