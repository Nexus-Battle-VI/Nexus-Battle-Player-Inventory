import { DomainError } from '../errors/DomainError'
import {
  computeEffectiveStats,
  type EffectiveStatsResult,
  type EquippedProductForStats,
} from '../services/effective-stats'
import type { HeroAttributeView } from '../value-objects/equipment-effects'
import { MIN_HERO_LEVEL } from '../value-objects/hero-level'
import { isHeroSubtype } from '../value-objects/hero-subtype'
import {
  applyEpicEffects,
  type AppliedEpicEffects,
  type EpicDefinition,
  type EpicEffect,
} from './EpicEffectPolicy'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * Adapta el contrato publicado por Catalog v1 al contrato conceptual HU-31.
 * Catalog omite generalEffect para "No aplica"; el resolver exige baseEffect
 * explicito en null. Un null enviado como generalEffect no es canonico v1.
 *
 * Solo valida la envoltura y los campos que este consumidor necesita. Catalog
 * es dueno de la semantica y validacion interna de cada efecto: se conservan
 * opacos, incluyendo condiciones, dados, duracion y campos futuros.
 */
export const parseEpicAttributes = (attributes: unknown): EpicDefinition => {
  const envelope = asRecord(attributes)
  const values = asRecord(envelope?.values)
  if (envelope?.schemaVersion !== '1' || values?.kind !== 'EPICA') {
    throw new DomainError('La epica debe declarar attributes canonicos de Catalog v1.')
  }

  const associatedHeroType = values.compatibleHeroSubtype
  if (typeof associatedHeroType !== 'string' || !isHeroSubtype(associatedHeroType)) {
    throw new DomainError('La epica debe declarar un compatibleHeroSubtype canonico valido.')
  }

  let baseEffect: EpicEffect | null = null
  if (Object.prototype.hasOwnProperty.call(values, 'generalEffect')) {
    baseEffect = asRecord(values.generalEffect)
    if (baseEffect === null) {
      throw new DomainError('generalEffect debe ser un objeto; omitalo cuando no aplica.')
    }
  }

  const additionalEffects = parseAdditionalEffects(values)

  return { associatedHeroType, baseEffect, additionalEffects }
}

/**
 * Catalog publica la forma canonica `specificEffects` (lista, minimo 1,
 * GAP-HU31-CATALOG-MULTI-EFFECT) o, para productos historicos, la forma
 * legada `specificEffect` (un unico objeto) -- este consumidor acepta ambas
 * y normaliza siempre a una lista, igual criterio que el propio parser de
 * Catalog. Las dos claves a la vez describen un documento hibrido invalido.
 */
const parseAdditionalEffects = (values: Record<string, unknown>): EpicEffect[] => {
  const hasList = Object.prototype.hasOwnProperty.call(values, 'specificEffects')
  const hasLegacy = Object.prototype.hasOwnProperty.call(values, 'specificEffect')

  if (hasList && hasLegacy) {
    throw new DomainError('La epica no puede declarar specificEffects y specificEffect a la vez.')
  }

  if (hasList) {
    const list = values.specificEffects
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      !list.every((item) => asRecord(item) !== null)
    ) {
      throw new DomainError('specificEffects debe ser una lista con al menos un objeto de efecto.')
    }
    return list as EpicEffect[]
  }

  if (hasLegacy) {
    const legacy = asRecord(values.specificEffect)
    if (legacy === null) {
      throw new DomainError('La epica debe declarar specificEffect como un objeto de efecto.')
    }
    return [legacy]
  }

  throw new DomainError('La epica debe declarar specificEffects (minimo 1 efecto).')
}

/**
 * Costo de Poder y recarga de la epica, tal como Catalog los deriva para
 * TODA EPICA (0 y 2, `EpicAttributes.powerCost`/`cooldownTurns`). Lectura
 * separada de `parseEpicAttributes`: son metadatos de ejecucion (HU-19), no
 * de aplicabilidad (HU-31) -- no se mezclan en `EpicDefinition`.
 */
export const parseEpicCombatDefaults = (
  attributes: unknown,
): { readonly powerCost: number; readonly cooldownTurns: number } => {
  const envelope = asRecord(attributes)
  const values = asRecord(envelope?.values)
  const powerCost = values?.powerCost
  const cooldownTurns = values?.cooldownTurns

  if (typeof powerCost !== 'number' || typeof cooldownTurns !== 'number') {
    throw new DomainError('La epica debe declarar powerCost y cooldownTurns numericos.')
  }

  return { powerCost, cooldownTurns }
}

export interface HeroEffectsWithEpic extends EffectiveStatsResult {
  /** Capas aplicables de HU-31. No representan ejecucion ni persistencia de la epica. */
  readonly epicEffects: AppliedEpicEffects
}

/**
 * Punto de composicion puro para quien disponga del heroe, equipamiento y
 * definicion de su epica activa. La seleccion y pertenencia deben resolverse
 * antes de invocarlo. No crea un slot EPICA ni modifica el contrato HTTP HU-28.
 *
 * HU-28 sigue calculando las estadisticas del equipo. HU-31 devuelve aparte
 * las capas aplicables, sin convertirlas en modificadores permanentes,
 * gastar poder, tirar dados o ejecutar condiciones/turnos del combate.
 */
export const computeHeroEffectsWithEpic = (
  hero: HeroAttributeView,
  equipped: readonly EquippedProductForStats[],
  epicAttributes: unknown = null,
  level: number = MIN_HERO_LEVEL,
): HeroEffectsWithEpic => {
  const epicEffects = applyEpicEffects({
    heroType: hero.heroSubtype,
    epic: epicAttributes === null ? null : parseEpicAttributes(epicAttributes),
  })

  return { ...computeEffectiveStats(hero.baseStats, equipped, level), epicEffects }
}
