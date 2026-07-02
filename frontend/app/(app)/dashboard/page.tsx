"use client"

import { useEffect, useRef, useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { useMe, useSyncWallets, useContracts, useActivity } from "@/lib/hooks"
import { walletsFromPrivyUser } from "@/lib/privy-wallets"
import { Copy, ExternalLink } from "lucide-react"

export default function DashboardPage() {
  const { user, authenticated } = usePrivy()
  const me = useMe(authenticated)
  const contracts = useContracts()
  const activity = useActivity(authenticated)
  const sync = useSyncWallets()
  const synced = useRef(false)

  // On first authenticated mount, push Privy linked wallets to the backend, then refresh /v1/me.
  useEffect(() => {
    if (!authenticated || synced.current) return
    const wallets = walletsFromPrivyUser(user as never)
    if (wallets.length === 0) return
    synced.current = true
    sync.mutate(wallets, { onSuccess: () => me.refetch() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, user])

  const wallets = me.data?.wallets ?? []

  return (
    <div className="space-y-10">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">Private balance</p>
        <h1 className="mt-2 font-sans text-6xl font-light tracking-tight" style={{ color: "#EDEAE3" }}>
          0.00 <span className="text-2xl text-muted-foreground">USDC</span>
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">shielded on Stellar · hidden from public chain</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Account */}
        <Card title="Account">
          <Field label="Identity (Privy DID)" value={me.data?.privy_user_id ?? user?.id ?? "—"} mono />
          {me.data?.email && <Field label="Email" value={me.data.email} />}
          <div className="mt-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Linked wallets</p>
            {wallets.length === 0 && <p className="font-mono text-xs text-muted-foreground">syncing…</p>}
            {wallets.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 py-1">
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {w.wallet_type}
                </span>
                <Mono value={w.address} />
              </div>
            ))}
          </div>
        </Card>

        {/* Network / contracts */}
        <Card title="Network">
          <Field label="Chain" value="Stellar testnet + Arbitrum Sepolia" />
          <Field label="Shielded pool" value={contracts.data?.shadePool ?? "—"} mono explorer="contract" />
          <Field label="Withdraw verifier" value={contracts.data?.verifierWithdraw ?? "—"} mono explorer="contract" />
          <Field label="USDC (SAC)" value={contracts.data?.usdcSac ?? "—"} mono explorer="contract" />
        </Card>
      </div>

      {/* Activity */}
      <Card title="Recent activity">
        {(activity.data?.activity ?? []).length === 0 && (
          <p className="font-mono text-xs text-muted-foreground">no activity yet — shield some USDC to begin.</p>
        )}
        <div className="space-y-1">
          {(activity.data?.activity ?? []).slice(0, 8).map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-4 border-b border-border/40 py-1.5 font-mono text-xs">
              <span className="text-foreground/80">{a.event_type}</span>
              <span className="text-muted-foreground">{new Date(a.created_at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-black/30 p-5 backdrop-blur-sm">
      <p className="mb-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, value, mono, explorer }: { label: string; value: string; mono?: boolean; explorer?: "contract" }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {mono ? <Mono value={value} explorer={explorer} /> : <span className="text-sm text-foreground/90">{value}</span>}
    </div>
  )
}

function Mono({ value, explorer }: { value: string; explorer?: "contract" }) {
  const [copied, setCopied] = useState(false)
  const short = value && value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value
  const url = explorer === "contract" ? `https://stellar.expert/explorer/testnet/contract/${value}` : undefined
  return (
    <span className="flex items-center gap-1.5 font-mono text-xs text-foreground/80">
      {short}
      {value && value !== "—" && (
        <>
          <button
            onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1000) }}
            className="text-muted-foreground hover:text-foreground"
            title="copy"
          >
            <Copy className="h-3 w-3" />
          </button>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {copied && <span className="text-[10px] text-emerald-400">copied</span>}
        </>
      )}
    </span>
  )
}
