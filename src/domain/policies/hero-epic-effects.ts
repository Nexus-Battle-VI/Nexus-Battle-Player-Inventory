import { DomainError } from '../errors/DomainError'
import {
  computeEffectiveStats,
  type EffectiveStatsResult,
  type EquippedProductForStats,
} from '../services/effective-stats'
import type { HeroAttributeView } from '../value-objects/equipment-effects'
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

  const additionalEffect = asRecord(values.specificEffect)
  if (additionalEffect === null) {
    throw new DomainError('La epica debe declarar specificEffect como un objeto de efecto.')
  }

  return { associatedHeroType, baseEffect, additionalEffect }
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
): HeroEffectsWithEpic => {
  const epicEffects = applyEpicEffects({
    heroType: hero.heroSubtype,
    epic: epicAttributes === null ? null : parseEpicAttributes(epicAttributes),
  })

  return { ...computeEffectiveStats(hero.baseStats, equipped), epicEffects }
}
