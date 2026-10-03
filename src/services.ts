import { createContext, useContext } from 'react'
import type { Services } from './firebase'

export const ServicesContext = createContext<Services | null>(null)

export function useServices(): Services {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('Services not ready')
  return s
}
