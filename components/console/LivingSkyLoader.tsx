'use client'

import dynamic from 'next/dynamic'

// Client-only: the experience depends on local time, matchMedia and WebGL,
// so skipping SSR avoids hydration mismatches.
const LivingSky = dynamic(() => import('./LivingSky'), {
  ssr: false,
  loading: () => <div className="min-h-dvh bg-[#02040a]" />,
})

export function LivingSkyLoader() {
  return <LivingSky />
}
