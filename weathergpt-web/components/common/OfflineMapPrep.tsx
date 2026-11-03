'use client'

/**
 * Settings: "Prepare offline demo" saves the map for the demo region so /map
 * works without internet (docs/DEMO.md). The weather data itself comes from
 * the backend's demo replay; this saves only basemap and terrain tiles.
 */

import { CloudDownload } from 'lucide-react'
import { useState } from 'react'
import { SkyButton } from '@/components/ui/SkyButton'
import { fill, useI18n } from '@/context/I18nContext'
import { formatLocalTime } from '@/lib/format'

type State = { kind: 'idle' } | { kind: 'working'; done: number; total: number } | { kind: 'failed' }

const KEY = 'wgpt:offline-map'

interface Info {
  at: string
  files: number
  bytes: number
  region: string
}

/** The panel mounts only when settings is opened, so localStorage is available. */
function readInfo(): Info | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Info) : null
  } catch {
    return null
  }
}

export function OfflineMapPrep() {
  const { t, language } = useI18n()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [info, setInfo] = useState<Info | null>(readInfo)

  const run = async () => {
    setState({ kind: 'working', done: 0, total: 0 })
    try {
      const { prepareOfflineMap } = await import('@/lib/offlineMap')
      setInfo(await prepareOfflineMap((done, total) => setState({ kind: 'working', done, total })))
      setState({ kind: 'idle' })
    } catch {
      setState({ kind: 'failed' })
    }
  }

  const localAt = info ? new Date(info.at) : null
  const atLabel =
    localAt && !Number.isNaN(localAt.getTime())
      ? formatLocalTime(
          `${localAt.getFullYear()}-${String(localAt.getMonth() + 1).padStart(2, '0')}-${String(localAt.getDate()).padStart(2, '0')}T${String(localAt.getHours()).padStart(2, '0')}:${String(localAt.getMinutes()).padStart(2, '0')}`,
          language
        )
      : ''

  return (
    <div data-testid="offline-map">
      <SkyButton variant="ghost" onClick={run} disabled={state.kind === 'working'} data-testid="offline-map-prepare" className="w-full justify-center">
        <CloudDownload className="size-4" aria-hidden /> {t('offlineMap.prepare')}
      </SkyButton>
      <p className="mt-1.5 text-[11px] text-hud-dim" role="status" data-testid="offline-map-status">
        {state.kind === 'working'
          ? fill(t('offlineMap.working'), { done: state.done, total: state.total || '…' })
          : state.kind === 'failed'
            ? t('offlineMap.failed')
            : info
              ? fill(t('offlineMap.done'), { files: info.files, mb: (info.bytes / 1_000_000).toFixed(1), region: info.region, at: atLabel })
              : t('offlineMap.note')}
      </p>
    </div>
  )
}
