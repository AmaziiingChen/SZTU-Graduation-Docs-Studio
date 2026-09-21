import { useEffect, useRef, useState } from "react"

// Independent, repeatable success receipts; pending and failed actions never call complete.
export function useActionFeedback() {
  const [completed, setCompleted] = useState<Record<string, number>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const sequence = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])
  const complete = (key: string) => {
    if (!mounted.current) return
    clearTimeout(timers.current.get(key))
    const token = ++sequence.current
    setCompleted((current) => ({ ...current, [key]: token }))
    timers.current.set(key, setTimeout(() => {
      timers.current.delete(key)
      setCompleted((current) => ({ ...current, [key]: 0 }))
    }, 1800))
  }
  const reset = (key: string) => {
    clearTimeout(timers.current.get(key))
    timers.current.delete(key)
    if (mounted.current) setCompleted((current) => ({ ...current, [key]: 0 }))
  }
  return { completed, complete, reset }
}
