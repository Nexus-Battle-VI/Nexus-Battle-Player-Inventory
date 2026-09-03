import { DomainError } from '../errors/DomainError'

/**
 * Los ocho subtipos de heroe de Nexus Battles VI.
 *
 * Es una proyeccion local del registro aprobado `hero-subtypes-v1` que Catalog
 * mantiene (PO-ATTR-01). Se duplica aqui a proposito, igual que el vocabulario
 * de roles: un paquete comun acoplaria los servicios y el limite entre
 * contextos dejaria de existir. Este contexto solo necesita reconocer el codigo
 * que Catalog publica en `attributes.values.heroSubtype`, no razonar sobre la
 * rama de combate.
 */
export const HERO_SUBTYPES = [
  'GUERRERO_TANQUE',
  'GUERRERO_ARMAS',
  'MAGO_FUEGO',
  'MAGO_HIELO',
  'PICARO_VENENO',
  'PICARO_MACHETE',
  'CHAMAN',
  'MEDICO',
] as const

export type HeroSubtype = (typeof HERO_SUBTYPES)[number]

export const isHeroSubtype = (value: string): value is HeroSubtype =>
  (HERO_SUBTYPES as readonly string[]).includes(value)

export const parseHeroSubtype = (raw: string): HeroSubtype => {
  const normalized = raw.trim().toUpperCase()

  if (!isHeroSubtype(normalized)) {
    throw new DomainError(`El subtipo de heroe "${raw}" no pertenece al registro vigente.`)
  }

  return normalized
}
