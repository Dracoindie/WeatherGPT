/**
 * reverseGeocode — turn (latitude, longitude) into a human-readable place name.
 *
 * Uses Nominatim (OpenStreetMap) — free, no API key required.
 * Rate limit: 1 request per second (adequate for prototype).
 *
 * Returns a city/town/village name, or a fallback string if unavailable.
 * Never throws — returns a fallback on any error.
 *
 * Privacy: coordinates are sent to Nominatim servers for reverse geocoding.
 * This is consistent with using OpenStreetMap tile data.
 */

export interface ReverseGeocodeResult {
  displayName: string   // e.g. "Pune, Maharashtra, India"
  city: string          // e.g. "Pune"
  country: string       // e.g. "India"
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const USER_AGENT = 'WeatherGPT-SIH2026/0.1 (prototype)'

export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult> {
  const fallback: ReverseGeocodeResult = {
    displayName: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    city: 'Unknown location',
    country: '',
  }

  try {
    const params = new URLSearchParams({
      lat: latitude.toString(),
      lon: longitude.toString(),
      format: 'json',
      addressdetails: '1',
      zoom: '10',        // city-level resolution
    })

    const response = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      // Nominatim requires a User-Agent; cache for 60s is fine
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      return fallback
    }

    const data = await response.json()
    const address = data?.address ?? {}

    const city =
      address.city ||
      address.town ||
      address.village ||
      address.county ||
      address.state_district ||
      ''

    const country = address.country || ''
    const state = address.state || ''

    const parts = [city, state, country].filter(Boolean)
    const displayName = parts.length > 0 ? parts.join(', ') : fallback.displayName

    return { displayName, city: city || fallback.city, country }
  } catch {
    // Network error, parse error, etc. — return coordinates as fallback
    return fallback
  }
}
