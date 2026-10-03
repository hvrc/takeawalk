import { useEffect, useState } from 'react'
import { useServices } from '../services'
import { subscribePolaroids, subscribeSegments, subscribeTrip } from '../lib/tripApi'
import type { Polaroid, Segment, Trip } from '../lib/types'

export function useTrip(tripId: string | undefined) {
  const { db } = useServices()
  const [trip, setTrip] = useState<Trip | null | undefined>(undefined)
  const [segments, setSegments] = useState<Segment[]>([])
  const [polaroids, setPolaroids] = useState<Polaroid[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tripId) return
    setTrip(undefined)
    const u1 = subscribeTrip(db, tripId, setTrip, (e) => setError(e.message))
    const u2 = subscribeSegments(db, tripId, setSegments)
    const u3 = subscribePolaroids(db, tripId, setPolaroids)
    return () => {
      u1()
      u2()
      u3()
    }
  }, [db, tripId])

  return { trip, segments, polaroids, error, loading: trip === undefined }
}
