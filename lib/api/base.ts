/**
 * Base URL of the FastAPI backend. Every backend call goes through this; a
 * relative "/api/..." URL would hit the Next.js server instead and 404.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8000'
