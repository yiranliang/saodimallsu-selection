import { useEffect, useSyncExternalStore } from 'react'
import { getDealRows, getDealSlots, loadDealSlots, subscribeDealSlots } from '../store/dealStore.js'

/**
 * 秒杀档期（sku → 档期数组）。
 *
 * 首次挂载时加载一次；之后靠 settings 同款的订阅机制拿到更新（导入完成、
 * 另一台设备改了档期）。
 */
export function useDealSlots() {
  const slots = useSyncExternalStore(subscribeDealSlots, getDealSlots, getDealSlots)

  useEffect(() => {
    loadDealSlots({ silent: true }).catch(() => {})
  }, [])

  return slots
}

/** 原始档期行（带 id），档期面板用。 */
export function useDealRows() {
  const rows = useSyncExternalStore(subscribeDealSlots, getDealRows, getDealRows)

  useEffect(() => {
    loadDealSlots({ silent: true }).catch(() => {})
  }, [])

  return rows
}
