import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'WeatherGPT — Living Sky',
    short_name: 'WeatherGPT',
    description:
      'Conversational weather and early-warning assistant: grounded forecasts, alerts and advisories in English, Hindi, Hinglish and Marathi.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#02040a',
    theme_color: '#040811',
    categories: ['weather', 'utilities'],
    lang: 'en-IN',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Alerts', url: '/alerts', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Dashboard', url: '/dashboard', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
