"use client"

import { stellarTx, arbTx, shortHash } from "@/lib/explorer"
import { ExternalLink } from "lucide-react"

// Clickable, truncated tx hash -> explorer. Stellar by default; chain="arb" for Arbitrum.
export function TxLink({ hash, chain = "stellar", label }: { hash?: string | null; chain?: "stellar" | "arb"; label?: string }) {
  if (!hash) return <span className="text-muted-foreground">—</span>
  const href = chain === "arb" ? arbTx(hash) : stellarTx(hash)
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-[#2563eb] hover:underline"
    >
      {label ?? shortHash(hash)}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}
