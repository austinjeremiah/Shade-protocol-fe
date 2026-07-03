"use client"

import { TxLink } from "@/components/tx-link"
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ShieldCheck } from "lucide-react"

// Noise + intermediate events we don't surface in the feed (wallet syncs, "prepare" steps).
export const ACTIVITY_HIDE = /^wallet\.|\.prepare$|^mpc\.intent\.routed$|^intent\.create$/

type Tone = "in" | "out" | "swap" | "vault" | "info"
const EVENT_META: Record<string, { label: string; sub?: string; tone: Tone }> = {
  "deposit.burn_submitted": { label: "Shielded USDC", sub: "0.50 USDC → private note", tone: "in" },
  "withdraw.settled": { label: "Withdrew USDC", sub: "0.50 USDC → Stellar account", tone: "out" },
  "rfq.swap.settled": { label: "Swapped to XLM", sub: "0.50 USDC → 1.00 XLM · solver", tone: "swap" },
  "mpc.match.settled": { label: "Privately matched", sub: "0.50 USDC ↔ 0.50 XLM · committee", tone: "swap" },
  "trade.settled": { label: "Private trade settled", sub: "RFQ intent → MPC match → ZK → settle", tone: "swap" },
  "shade_view.report.generate": { label: "Compliance report", sub: "signed selective disclosure", tone: "vault" },
  "vault.create": { label: "Vault created", tone: "vault" },
  "vault.backup_verified": { label: "Vault backup verified", tone: "vault" },
}
const TONE_ICON: Record<Tone, React.ReactNode> = {
  in: <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" />,
  out: <ArrowUpRight className="h-3.5 w-3.5 text-amber-400" />,
  swap: <ArrowLeftRight className="h-3.5 w-3.5 text-[#2563eb]" />,
  vault: <ShieldCheck className="h-3.5 w-3.5 text-[#2563eb]" />,
  info: <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />,
}
function humanize(ev: string): string {
  return ev.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ActivityItem({ event, tx, at }: { event: string; tx: string | null; at: string }) {
  const meta = EVENT_META[event] ?? { label: humanize(event), tone: "info" as Tone }
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-2 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">{TONE_ICON[meta.tone]}</span>
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-foreground/90">{meta.label}</p>
          {meta.sub && <p className="truncate font-mono text-[10px] text-muted-foreground">{meta.sub}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {tx && <TxLink hash={tx} />}
        <span className="font-mono text-[10px] text-muted-foreground">{new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  )
}
