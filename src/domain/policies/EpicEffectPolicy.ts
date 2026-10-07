import { DomainError } from '../errors/DomainError'
import { HERO_SUBTYPES, isHeroSubtype } from '../value-objects/hero-subtype'
import type { HeroSubtype } from '../value-objects/hero-subtype'

/** La frontera HU-31 usa el mismo registro de subtipos que HU-28. */
export const VALID_HERO_TYPES = HERO_SUBTYPES
export type HeroType = HeroSubtype

/**
 * HU-31 decide la aplicabilidad; no interpreta ni ejecuta el contenido del
 * efecto. Una capa puede contener varios efectos funcionales relacionados.
 */
export type EpicEffect = Readonly<Record<string, unknown>>

/**
 * Las propiedades opcionales permiten validar contratos incompletos en la
 * frontera. Una base explicita en null significa "No aplica"; omitirla o
 * declararla undefined es invalido. La lista de efectos adicionales debe
 * existir y tener al menos un elemento.
 *
 * `additionalEffects` es plural desde la correccion GAP-HU31-CATALOG-MULTI-EFFECT:
 * Catalog confirma epicas oficiales con mas de un efecto especifico simultaneo
 * (Tabla 20). `generalEffect`/`baseEffect` se mantiene singular: ninguna fuente
 * exige multiples efectos generales.
 */
export interface EpicDefinition {
  readonly associatedHeroType?: unknown
  readonly baseEffect?: EpicEffect | null
  readonly additionalEffects?: readonly EpicEffect[]
}

export interface ApplyEpicEffectsInput {
  readonly heroType: unknown
  readonly epic?: EpicDefinition | null
}

export interface AppliedEpicEffects {
  readonly baseApplied: EpicEffect | null
  /** Vacio si el subtipo no coincide; todos los efectos especificos si coincide. */
  readonly additionalApplied: readonly EpicEffect[]
  readonly combined: readonly EpicEffect[]
}

interface ValidatedEpicDefinition extends EpicDefinition {
  readonly associatedHeroType: HeroType
  readonly baseEffect: EpicEffect | null
  readonly additionalEffects: readonly EpicEffect[]
}

const isRecord = (value: unknown): value is EpicEffect =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = (value: object, property: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, property)

const requireHeroType = (value: unknown, fieldName: string): HeroType => {
  if (typeof value !== 'string' || !isHeroSubtype(value)) {
    throw new DomainError(
      `${fieldName} debe ser un subtipo canonico valido: ${HERO_SUBTYPES.join(', ')}.`,
    )
  }

  return value
}

const validateEpic: (epic: EpicDefinition) => asserts epic is ValidatedEpicDefinition = (epic) => {
  requireHeroType(epic.associatedHeroType, 'associatedHeroType')

  if (!hasOwn(epic, 'baseEffect')) {
    throw new DomainError(
      'La epica debe declarar baseEffect. Use null cuando el efecto general sea "No aplica".',
    )
  }

  if (epic.baseEffect !== null && !isRecord(epic.baseEffect)) {
    throw new DomainError('baseEffect debe ser un objeto de efecto o null.')
  }

  if (
    !hasOwn(epic, 'additionalEffects') ||
    !Array.isArray(epic.additionalEffects) ||
    epic.additionalEffects.length === 0 ||
    !epic.additionalEffects.every(isRecord)
  ) {
    throw new DomainError(
      'La epica debe declarar additionalEffects como una lista con al menos un objeto de efecto.',
    )
  }
}

/**
 * Resuelve las capas de la epica ya activa segun el subtipo del heroe.
 *
 * Funcion pura: no equipa, no persiste, no modifica estadisticas y no ejecuta
 * combate. Retorna una lista nueva con las referencias originales, en orden
 * general/especifico. No exige nombres de epicas ni un catalogo cerrado.
 */
export const applyEpicEffects = (input: ApplyEpicEffectsInput): AppliedEpicEffects => {
  if (!isRecord(input)) {
    throw new DomainError('La entrada debe declarar heroType y una epica opcional.')
  }

  const heroType = requireHeroType(input.heroType, 'heroType')

  if (input.epic === null || input.epic === undefined) {
    return {
      baseApplied: null,
      additionalApplied: [],
      combined: [],
    }
  }

  if (!isRecord(input.epic)) {
    throw new DomainError('epic debe ser una definicion de epica o null.')
  }

  validateEpic(input.epic)

  const baseApplied = input.epic.baseEffect
  const additionalApplied =
    heroType === input.epic.associatedHeroType ? input.epic.additionalEffects : []

  return {
    baseApplied,
    additionalApplied,
    combined: [...(baseApplied === null ? [] : [baseApplied]), ...additionalApplied],
  }
}
