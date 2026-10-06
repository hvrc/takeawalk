import { useEffect, useState } from 'react'
import { useServices } from '../services'
import { subscribePolaroids, subscribeSegments, subscribeTrip } from '../lib/tripApi'
import type { Polaroid, Segment, Trip } from '../lib/types'

export function useTrip(tripId: string | undefined, retryKey = 0) {
  const { db } = useServices()
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined)
  const [segments, setSegments] = useState<Segment[]>([])
  const [polaroids, setPolaroids] = useState<Polaroid[]>([])
  const [error, setError] = useState<string | null>(null)
  // A private walk you're not on yet: the database won't show it to you.
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    if (!tripId) return
    setTrip(undefined)
    setDenied(false)
    setError(null)
    const u1 = subscribeTrip(db, tripId, setTrip, (e) => {
      if ((e as { code?: string }).code === 'permission-denied') setDenied(true)
      else setError(e.message)
    })
    const u2 = subscribeSegments(db, tripId, setSegments)
    const u3 = subscribePolaroids(db, tripId, setPolaroids)
    return () => {
      u1()
      u2()
      u3()
    }
  }, [db, tripId, retryKey])

  return { trip, segments, polaroids, error, denied, loading: trip === undefined && !denied }
}
