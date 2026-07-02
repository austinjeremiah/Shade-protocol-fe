"use client"

import { useQuery, useMutation } from "@tanstack/react-query"
import { api, type Me, type Contracts, type HealthFull, type SyncWalletInput } from "./api"

export function useContracts() {
  return useQuery({ queryKey: ["contracts"], queryFn: () => api.get<Contracts>("/v1/contracts", false) })
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: () => api.get<HealthFull>("/v1/health/full", false), refetchInterval: 15000 })
}

export function useMe(enabled: boolean) {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/v1/me"), enabled })
}

export function useSyncWallets() {
  return useMutation({
    mutationFn: (wallets: SyncWalletInput[]) =>
      api.post<{ synced: number; wallets: Me["wallets"] }>("/v1/me/wallets/sync-privy", { wallets }),
  })
}

export type ActivityRow = {
  event_type: string
  entity_type: string | null
  entity_id: string | null
  tx_hash: string | null
  metadata: Record<string, unknown>
  created_at: string
}
export function useActivity(enabled: boolean) {
  return useQuery({
    queryKey: ["activity"],
    queryFn: () => api.get<{ activity: ActivityRow[] }>("/v1/activity"),
    enabled,
    refetchInterval: 5000,
  })
}
