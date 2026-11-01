/**
 * DemoContext — ephemeral presentation-only access state.
 *
 * This state intentionally lives only in React memory. It is not an identity,
 * does not represent a Supabase session, and is lost on page reload.
 */

'use client'

import { createContext, useCallback, useContext, useState } from 'react'

interface DemoContextValue {
  isDemo: boolean
  enterDemo: () => void
}

const DemoContext = createContext<DemoContextValue | null>(null)

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [isDemo, setIsDemo] = useState(false)
  const enterDemo = useCallback(() => setIsDemo(true), [])

  return (
    <DemoContext.Provider value={{ isDemo, enterDemo }}>
      {children}
    </DemoContext.Provider>
  )
}

export function useDemoContext(): DemoContextValue {
  const context = useContext(DemoContext)
  if (!context) {
    throw new Error('useDemoContext must be used within <DemoProvider>')
  }
  return context
}
