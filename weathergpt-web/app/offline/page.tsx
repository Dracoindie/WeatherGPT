import Link from 'next/link'
import { WifiOff } from 'lucide-react'

/** Fallback page the service worker serves when a page was never cached. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#02040a] px-6 text-center text-[#e7f0ff]">
      <WifiOff className="size-10 text-amber-300" aria-hidden="true" />
      <h1 className="text-2xl font-semibold">You are offline</h1>
      <p className="max-w-sm text-sm text-white/70">
        This page has not been saved on this device yet. The home screen shows your last
        forecast while you are offline; live data returns when you reconnect.
      </p>
      <Link href="/" className="rounded-full border border-cyan-300/50 px-4 py-2 text-sm text-cyan-200">
        Open the last forecast
      </Link>
    </main>
  )
}
