"use client"

import type React from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useEffect } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { useHealth } from "@/lib/hooks"

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/deposit", label: "Deposit" },
  { href: "/move", label: "Move" },
  { href: "/reports", label: "Compliance" },
  { href: "/activity", label: "Activity" },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, logout } = usePrivy()
  const router = useRouter()
  const pathname = usePathname()
  const health = useHealth()

  useEffect(() => {
    if (ready && !authenticated) router.replace("/")
  }, [ready, authenticated, router])

  if (!ready) return <FullScreenNote text="loading…" />
  if (!authenticated) return <FullScreenNote text="redirecting…" />

  return (
    <div className="min-h-screen" style={{ background: "#050505" }}>
      <header className="sticky top-0 z-40 border-b border-border bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="font-sans text-lg font-light tracking-tight" style={{ color: "#EDEAE3" }}>
            SHADE
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`font-mono text-xs uppercase tracking-wider transition-colors ${
                  pathname?.startsWith(n.href) ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${health.data?.ok ? "bg-emerald-400" : "bg-red-400"}`} />
              testnet
            </span>
            <button
              onClick={() => logout()}
              className="rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Disconnect
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  )
}

function FullScreenNote({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: "#050505" }}>
      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{text}</span>
    </div>
  )
}
