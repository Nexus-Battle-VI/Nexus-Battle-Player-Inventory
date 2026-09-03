import { DomainError } from '../errors/DomainError'

/**
 * Vista minima y estructurada de `attributes` de Catalog para HU-28.
 *
 * Player/Inventory NO es dueno de este contrato: lo publica Catalog en
 * `GET /api/v1/catalog/products/:ref` y en `POST .../lookup`, y aqui llega
 * opaco. Este modulo lo interpreta solo hasta donde el equipamiento necesita:
 * la familia, la ranura de armadura, la compatibilidad declarada y los efectos.
 * No reimplementa el parser de dominio de Catalog ni lo sustituye; toma el
 * subconjunto que este consumidor requiere y trata el resto como desconocido.
 */

export const EFFECT_STATISTICS = [
  'POWER',
  'HEALTH',
  'DEFENSE',
  'ATTACK',
  'DAMAGE',
  'HEALING',
  'CRITICAL_CHANCE',
] as const

export type EffectStatistic = (typeof EFFECT_STATISTICS)[number]

export const EFFECT_OPERATIONS = [
  'INCREASE',
  'DECREASE',
  'MULTIPLY',
  'SET',
  'BLOCK',
  'RESTORE',
] as const

export type EffectOperation = (typeof EFFECT_OPERATIONS)[number]

export interface FixedMagnitude {
  readonly mode: 'FIXED'
  readonly amount: number
}
export interface PercentageMagnitude {
  readonly mode: 'PERCENTAGE'
  readonly basisPoints: number
}
export interface DiceMagnitude {
  readonly mode: 'DICE'
  readonly count: number
  readonly sides: number
}
export type Magnitude = FixedMagnitude | PercentageMagnitude | DiceMagnitude

/**
 * Efecto de un producto equipado, ya normalizado con su procedencia.
 *
 * `kind`, `target`, `durationTurns` y `activationCondition` se conservan tal
 * como los publica Catalog. `raw` guarda el objeto original completo para que
 * una HU futura (Battle / HU-29 / HU-31) pueda consumir la semantica sin volver
 * a Catalog. La procedencia (`source*`) la anade Player/Inventory.
 */
export interface EquippedEffect {
  readonly sourceSlot: string
  readonly sourceProductId: string
  readonly sourceProductReference: string
  readonly kind: string
  readonly target: string
  readonly statistic?: EffectStatistic
  readonly operation?: EffectOperation
  readonly magnitude?: Magnitude
  readonly durationTurns?: number
  readonly hasActivationCondition: boolean
  /** `true` cuando este efecto se refleja YA en las estadisticas efectivas. */
  readonly appliedToStats: boolean
  readonly raw: unknown
}

export interface HeroBaseStats {
  readonly power: number
  readonly health: number
  readonly defense: number
  /** Valor base de ataque/dano/sanacion tal como lo declara el heroe. */
  readonly attack: number | null
  readonly damage: Magnitude | null
  readonly healing: Magnitude | null
}

export interface HeroAttributeView {
  readonly kind: 'HEROE'
  readonly heroSubtype: string
  readonly baseStats: HeroBaseStats
}

export interface EquippableAttributeView {
  readonly kind: 'ARMA' | 'ARMADURA' | 'ITEM'
  /** Codigo `ArmorSlot` de Catalog (`HEAD`, `CHEST`, ...). Solo en `ARMADURA`. */
  readonly armorSlot: string | null
  readonly compatibilityScope: string | null
  readonly compatibleHeroSubtypes: readonly string[]
  readonly effects: readonly ParsedEffect[]
}

export interface ParsedEffect {
  readonly kind: string
  readonly target: string
  readonly statistic?: EffectStatistic
  readonly operation?: EffectOperation
  readonly magnitude?: Magnitude
  readonly durationTurns?: number
  readonly hasActivationCondition: boolean
  readonly raw: unknown
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const parseMagnitude = (value: unknown): Magnitude | undefined => {
  const record = asRecord(value)
  if (record === null) return undefined

  if (record.mode === 'FIXED') {
    const amount = asFiniteNumber(record.amount)
    return amount === null ? undefined : { mode: 'FIXED', amount }
  }
  if (record.mode === 'PERCENTAGE') {
    const basisPoints = asFiniteNumber(record.basisPoints)
    return basisPoints === null ? undefined : { mode: 'PERCENTAGE', basisPoints }
  }
  if (record.mode === 'DICE') {
    const count = asFiniteNumber(record.count)
    const sides = asFiniteNumber(record.sides)
    return count === null || sides === null ? undefined : { mode: 'DICE', count, sides }
  }
  return undefined
}

const parseEffect = (value: unknown): ParsedEffect => {
  const record = asRecord(value) ?? {}
  const kind = typeof record.kind === 'string' ? record.kind : 'UNKNOWN'
  const target = typeof record.target === 'string' ? record.target : 'SELF'
  const statisticRaw = typeof record.statistic === 'string' ? record.statistic : undefined
  const operationRaw = typeof record.operation === 'string' ? record.operation : undefined
  const durationTurns = asFiniteNumber(record.durationTurns)

  return {
    kind,
    target,
    ...(statisticRaw !== undefined &&
    (EFFECT_STATISTICS as readonly string[]).includes(statisticRaw)
      ? { statistic: statisticRaw as EffectStatistic }
      : {}),
    ...(operationRaw !== undefined &&
    (EFFECT_OPERATIONS as readonly string[]).includes(operationRaw)
      ? { operation: operationRaw as EffectOperation }
      : {}),
    ...(parseMagnitude(record.magnitude) === undefined
      ? {}
      : { magnitude: parseMagnitude(record.magnitude) }),
    ...(durationTurns === null ? {} : { durationTurns }),
    hasActivationCondition: record.activationCondition !== undefined,
    raw: value,
  }
}

const parseEffects = (value: unknown): readonly ParsedEffect[] =>
  Array.isArray(value) ? value.map(parseEffect) : []

/**
 * Interpreta `attributes` de un producto HEROE. Lanza `DomainError` si el sobre
 * no tiene la forma esperada: un heroe sin estadisticas base no se puede
 * configurar.
 */
export const parseHeroAttributes = (attributes: unknown): HeroAttributeView => {
  const envelope = asRecord(attributes)
  const values = asRecord(envelope?.values)

  if (values === null) {
    throw new DomainError('El producto de referencia no es un heroe canonico valido.')
  }
  if (values.kind !== 'HEROE') {
    throw new DomainError('El producto de referencia no es un heroe canonico valido.')
  }

  const power = asFiniteNumber(values.basePower)
  const health = asFiniteNumber(values.baseHealth)
  const defense = asFiniteNumber(values.baseDefense)
  const heroSubtype = typeof values.heroSubtype === 'string' ? values.heroSubtype : null

  if (power === null || health === null || defense === null || heroSubtype === null) {
    throw new DomainError('El heroe canonico no declara sus estadisticas base completas.')
  }

  const attackMagnitude = parseMagnitude(values.baseAttack)

  return {
    kind: 'HEROE',
    heroSubtype,
    baseStats: {
      power,
      health,
      defense,
      attack: attackMagnitude?.mode === 'FIXED' ? attackMagnitude.amount : null,
      damage: parseMagnitude(values.baseDamage) ?? null,
      healing: parseMagnitude(values.baseHealing) ?? null,
    },
  }
}

/**
 * Interpreta `attributes` de un producto equipable (`ARMA`, `ARMADURA`,
 * `ITEM`). Lanza `DomainError` si el sobre no corresponde a esas familias.
 */
export const parseEquippableAttributes = (attributes: unknown): EquippableAttributeView => {
  const envelope = asRecord(attributes)
  const values = asRecord(envelope?.values)

  if (values === null) {
    throw new DomainError('El producto no pertenece a una familia equipable de HU-28.')
  }

  const kind = values.kind
  if (kind !== 'ARMA' && kind !== 'ARMADURA' && kind !== 'ITEM') {
    throw new DomainError('El producto no pertenece a una familia equipable de HU-28.')
  }

  const compatibleRaw = values.compatibleHeroSubtypes
  const compatibleHeroSubtypes = Array.isArray(compatibleRaw)
    ? compatibleRaw.filter((entry): entry is string => typeof entry === 'string')
    : []

  return {
    kind,
    armorSlot: kind === 'ARMADURA' && typeof values.slot === 'string' ? values.slot : null,
    compatibilityScope:
      typeof values.compatibilityScope === 'string' ? values.compatibilityScope : null,
    compatibleHeroSubtypes,
    effects: parseEffects(values.effects),
  }
}
