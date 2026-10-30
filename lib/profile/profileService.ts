/**
 * profileService — typed CRUD for the user's profile, preferences,
 * and saved locations.
 *
 * All operations use the browser Supabase client.  RLS policies on the
 * database ensure a user can never read or modify another user's rows.
 *
 * Privacy model:
 *  - We store only what is needed for the prototype.
 *  - Passwords are never stored — Supabase Auth handles that.
 *  - No raw auth tokens are persisted in these tables.
 *  - No location history is accumulated — only one default location.
 */

import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  preferred_language: string
  default_latitude: number | null
  default_longitude: number | null
  default_location_name: string | null
  location_permission: boolean
  created_at: string
  updated_at: string
}

export type ProfileUpdate = Partial<
  Pick<
    Profile,
    | 'full_name'
    | 'preferred_language'
    | 'default_latitude'
    | 'default_longitude'
    | 'default_location_name'
    | 'location_permission'
  >
>

export interface UserPreferences {
  user_id: string
  temperature_unit: 'celsius' | 'fahrenheit'
  notification_enabled: boolean
  severe_alert_enabled: boolean
  voice_enabled: boolean
  preferred_language: string
}

export type PreferencesUpdate = Partial<
  Omit<UserPreferences, 'user_id'>
>

export interface SavedLocation {
  id: string
  user_id: string
  name: string
  latitude: number
  longitude: number
  created_at: string
}

export interface NewSavedLocation {
  name: string
  latitude: number
  longitude: number
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[profileService] getProfile error:', error.message)
    return null
  }
  return data as Profile
}

export async function upsertProfile(
  userId: string,
  updates: ProfileUpdate
): Promise<Profile | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...updates }, { onConflict: 'id' })
    .select()
    .single()

  if (error) {
    console.error('[profileService] upsertProfile error:', error.message)
    return null
  }
  return data as Profile
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function getPreferences(userId: string): Promise<UserPreferences | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) {
    // PGRST116 = no rows — preferences haven't been created yet
    if (error.code !== 'PGRST116') {
      console.error('[profileService] getPreferences error:', error.message)
    }
    return null
  }
  return data as UserPreferences
}

export async function upsertPreferences(
  userId: string,
  updates: PreferencesUpdate
): Promise<UserPreferences | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) {
    console.error('[profileService] upsertPreferences error:', error.message)
    return null
  }
  return data as UserPreferences
}

// ---------------------------------------------------------------------------
// Saved locations
// ---------------------------------------------------------------------------

export async function getSavedLocations(userId: string): Promise<SavedLocation[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('saved_locations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[profileService] getSavedLocations error:', error.message)
    return []
  }
  return (data ?? []) as SavedLocation[]
}

export async function addSavedLocation(
  userId: string,
  location: NewSavedLocation
): Promise<SavedLocation | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('saved_locations')
    .insert({ user_id: userId, ...location })
    .select()
    .single()

  if (error) {
    console.error('[profileService] addSavedLocation error:', error.message)
    return null
  }
  return data as SavedLocation
}

export async function deleteSavedLocation(id: string): Promise<boolean> {
  const supabase = createClient()
  const { error } = await supabase
    .from('saved_locations')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[profileService] deleteSavedLocation error:', error.message)
    return false
  }
  return true
}
