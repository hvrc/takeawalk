import type { Timestamp } from 'firebase/firestore'

export type TripStatus = 'active' | 'published'

export interface Member {
  name: string
  color: string
  joinedAt: number
  lastSeenAt: number
  lastPos?: { lat: number; lng: number; t: number; acc: number } | null
  tracking?: boolean
}

export interface Trip {
  id: string
  name: string
  code: string
  status: TripStatus
  createdBy: string
  createdAt: number
  updatedAt: number
  members: Record<string, Member>
  pointCount: number
  polaroidCount: number
  distanceM: number
  coverUrl?: string | null
}

export interface GeoPoint {
  lat: number
  lng: number
  t: number
  acc: number
}

export interface Segment {
  id: string
  memberId: string
  color: string
  startedAt: number
  endedAt: number | null
  points: GeoPoint[]
}

export interface Polaroid {
  id: string
  memberId: string
  memberName: string
  color: string
  lat: number
  lng: number
  acc: number
  takenAt: number
  caption: string
  description: string
  imagePath: string
  imageUrl: string
  pending?: boolean
}

export type FsTimestamp = Timestamp
