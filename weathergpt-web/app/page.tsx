import { LivingSkyLoader } from '@/components/console/LivingSkyLoader'

/**
 * Living Sky home. Public (no AuthGuard): anonymous users can ask about any
 * named place; signed-in users also get their saved default location.
 * (The old /classic redirect was removed; /dashboard is in the nav.)
 */
export default function Home() {
  return <LivingSkyLoader />
}
