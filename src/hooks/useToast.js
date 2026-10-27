import { useState, useCallback, useRef } from 'react'

/**
 * Toast 提示 Hook
 * ────────────────
 * 用法：
 *   const { toasts, showToast } = useToast()
 *   showToast('已复制', 'success')
 */
export function useToast() {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const showToast = useCallback((message, type = 'default', duration = 2000) => {
    const id = ++idRef.current

    // 同一时刻只保留最新一条，避免连续操作时堆叠遮挡页面
    setToasts([{ id, message, type }])

    // 到时自动移除
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, duration)
  }, [])

  return { toasts, showToast }
}
