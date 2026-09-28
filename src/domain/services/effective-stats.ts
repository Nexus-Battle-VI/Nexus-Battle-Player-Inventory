import { MAX_HERO_LEVEL, MIN_HERO_LEVEL } from '../value-objects/hero-level'
import { DomainError } from '../errors/DomainError'
import type {
  EffectStatistic,
  EquippableAttributeView,
  EquippedEffect,
  HeroBaseStats,
  Magnitude,
  ParsedEffect,
} from '../value-objects/equipment-effects'

/**
 * Calculo de estadisticas efectivas del heroe (RF-28, CA-08).
 *
 * REGLA CENTRAL: las estadisticas base NUNCA se mutan. El resultado efectivo se
 * reconstruye siempre desde `baseStats + loadout + definiciones vigentes`, de
 * modo que quitar o cambiar una pieza en una HU futura no exige "adivinar" el
 * valor anterior. Este modulo es una funcion pura sin estado.
 *
 * EL NIVEL MULTIPLICA LAS ESTADISTICAS (HU-08, CA-06). Decision funcional vigente,
 * que sigue la regla del PDF («un mago de fuego de nivel 1 posee un ataque base
 * de 10; uno de nivel 3, de 30») y del PO:
 *
 *   estadistica de nivel = estadistica base (nivel 1) x nivel actual
 *   estadistica efectiva = estadistica de nivel  +/-  equipamiento
 *
 * es decir, `(base x nivel) + efectos del equipamiento`, NO
 * `(base + equipamiento) x nivel`: no son equivalentes. La «base» sobre la que
 * operan los efectos porcentuales (`+10 %`), multiplicativos y `SET` del
 * equipamiento es la base YA ESCALADA por el nivel, porque esa es la base del
 * heroe a ese nivel. En nivel 1 el factor es 1 y el resultado es identico al de
 * antes de CA-06.
 *
 * QUE SE ESCALA: `power`, `health`, `defense` y `attack` (las estadisticas
 * numericas que este modulo sabe recalcular; `LEVEL_SCALED_STATS`). QUE NO:
 * `damage` y `healing`, que son magnitudes (dados o valores fijos) y NO un numero
 * que este modulo pueda multiplicar: aqui se publican tal cual. El nivel las
 * multiplica en el RESULTADO FINAL de la tirada (opcion A, decision del PO:
 * `1d6`, nivel 3, tirada 4 => 4 x 3 = 12), y eso lo hace Combat al resolver el
 * dado; este servicio no tira dados. `power` SI escala (confirmado por el PO).
 *
 * HU-28 aplica AHORA solo los modificadores deterministas y permanentes sobre
 * el propio heroe: `STAT_MODIFIER` con `target = SELF`, sin condicion de
 * activacion y sin duracion. Todo lo demas —efectos al oponente, por turnos,
 * condicionales, dano/sanacion como efecto, estados temporales— se conserva
 * estructurado en `activeEffects` para que el motor de combate (HU-29+) lo
 * consuma. HU-28 no ejecuta semantica de combate.
 */

export interface EquippedProductForStats {
  readonly slot: string
  readonly productId: string
  readonly reference: string
  readonly attributes: EquippableAttributeView
}

export interface NumericStatDelta {
  readonly statistic: EffectStatistic
  readonly base: number
  readonly effective: number
  readonly delta: number
}

export interface EffectiveStatsResult {
  /** Nivel del heroe con el que se calcularon las estadisticas de nivel y efectivas. */
  readonly level: number
  /** Estadisticas base de Catalog (nivel 1), sin escalar. */
  readonly baseStats: {
    readonly power: number
    readonly health: number
    readonly defense: number
    readonly attack: number | null
    readonly damage: Magnitude | null
    readonly healing: Magnitude | null
  }
  /** Base x nivel (CA-06), antes de aplicar el equipamiento. `damage` y `healing` se publican como magnitud (el nivel multiplica el resultado de la tirada en Combat). */
  readonly levelStats: {
    readonly power: number
    readonly health: number
    readonly defense: number
    readonly attack: number | null
    readonly damage: Magnitude | null
    readonly healing: Magnitude | null
  }
  readonly effectiveStats: {
    readonly power: number
    readonly health: number
    readonly defense: number
    readonly attack: number | null
    readonly damage: Magnitude | null
    readonly healing: Magnitude | null
  }
  /** Solo las estadisticas numericas que el EQUIPAMIENTO cambio respecto a `levelStats`. */
  readonly deltas: readonly NumericStatDelta[]
  /** Todos los efectos del equipamiento, con procedencia y si ya estan aplicados. */
  readonly activeEffects: readonly EquippedEffect[]
}

/** Estadisticas numericas del heroe que HU-28 sabe recalcular. */
/** Estadisticas numericas del heroe que HU-28 sabe recalcular a un valor. */
const NUMERIC_STATS: ReadonlySet<string> = new Set(['POWER', 'HEALTH', 'DEFENSE', 'ATTACK'])

/** Estadisticas que el nivel multiplica (CA-06). Un unico punto para poder recortarlas. */
export const LEVEL_SCALED_STATS: readonly EffectStatistic[] = [
  'POWER',
  'HEALTH',
  'DEFENSE',
  'ATTACK',
]

/** Rechaza un nivel fuera de `1..8` en lugar de escalar con un dato invalido. */
const requireLevel = (level: unknown): number => {
  if (
    typeof level !== 'number' ||
    !Number.isInteger(level) ||
    level < MIN_HERO_LEVEL ||
    level > MAX_HERO_LEVEL
  ) {
    throw new DomainError(
      `El nivel del heroe debe ser un entero entre ${String(MIN_HERO_LEVEL)} y ${String(MAX_HERO_LEVEL)}.`,
    )
  }

  return level
}

/**
 * Estadisticas base multiplicadas por el nivel (CA-06). Pura. `attack` nulo
 * (heroes sin capacidad ofensiva) sigue nulo; `damage` y `healing` no se tocan.
 */
export const scaleBaseStatsByLevel = (baseStats: HeroBaseStats, level: number): HeroBaseStats => {
  const factor = requireLevel(level)
  const scaled = (stat: EffectStatistic, value: number): number =>
    LEVEL_SCALED_STATS.includes(stat) ? value * factor : value

  return {
    ...baseStats,
    power: scaled('POWER', baseStats.power),
    health: scaled('HEALTH', baseStats.health),
    defense: scaled('DEFENSE', baseStats.defense),
    attack: baseStats.attack === null ? null : scaled('ATTACK', baseStats.attack),
  }
}

interface Accumulator {
  additive: number
  percentOfBase: number
  multipliers: number[]
  setValue: number | null
}

const emptyAccumulator = (): Accumulator => ({
  additive: 0,
  percentOfBase: 0,
  multipliers: [],
  setValue: null,
})

const magnitudeFactor = (magnitude: Magnitude): number | null => {
  if (magnitude.mode === 'FIXED') return magnitude.amount
  if (magnitude.mode === 'PERCENTAGE') return 1 + magnitude.basisPoints / 10_000
  return null
}

const magnitudeAmount = (magnitude: Magnitude, base: number): number | null => {
  if (magnitude.mode === 'FIXED') return magnitude.amount
  if (magnitude.mode === 'PERCENTAGE') return (magnitude.basisPoints / 10_000) * base
  return null
}

type ApplicableStatModifier = ParsedEffect & {
  readonly statistic: EffectStatistic
  readonly magnitude: Magnitude
}

/**
 * Indica si un efecto es de los que HU-28 refleja YA en las estadisticas
 * efectivas del heroe: un `STAT_MODIFIER` permanente (sin duracion ni
 * condicion), dirigido al propio heroe, sobre una estadistica numerica que este
 * modulo sabe recalcular. El resto se preserva estructurado pero no se ejecuta.
 */
const isApplicableStatModifier = (effect: ParsedEffect): effect is ApplicableStatModifier =>
  effect.kind === 'STAT_MODIFIER' &&
  effect.target === 'SELF' &&
  effect.durationTurns === undefined &&
  !effect.hasActivationCondition &&
  effect.statistic !== undefined &&
  effect.magnitude !== undefined &&
  NUMERIC_STATS.has(effect.statistic)

const roundClampNonNegative = (value: number): number => Math.max(0, Math.round(value))

export const computeEffectiveStats = (
  catalogBaseStats: HeroBaseStats,
  equipped: readonly EquippedProductForStats[],
  level: number,
): EffectiveStatsResult => {
  // CA-06: el equipamiento opera sobre la base YA multiplicada por el nivel.
  const baseStats = scaleBaseStatsByLevel(catalogBaseStats, level)
  const accumulators = new Map<EffectStatistic, Accumulator>()
  const activeEffects: EquippedEffect[] = []

  for (const product of equipped) {
    for (const effect of product.attributes.effects) {
      // HU-28 refleja YA en las estadisticas los modificadores permanentes al
      // propio heroe sobre ataque/defensa/vida/poder. El critico y otros
      // atributos que RF-28 trata como "efectos" se preservan estructurados,
      // pero no se colapsan a un numero aqui.
      const applied = isApplicableStatModifier(effect)

      if (applied) {
        const stat = effect.statistic
        const magnitude = effect.magnitude
        const acc = accumulators.get(stat) ?? emptyAccumulator()
        const baseValue = baseValueOf(stat, baseStats)

        if (effect.operation === 'SET') {
          if (magnitude.mode === 'FIXED') acc.setValue = magnitude.amount
        } else if (effect.operation === 'MULTIPLY') {
          const factor = magnitudeFactor(magnitude)
          if (factor !== null) acc.multipliers.push(factor)
        } else if (effect.operation === 'INCREASE' || effect.operation === 'DECREASE') {
          const sign = effect.operation === 'DECREASE' ? -1 : 1
          if (magnitude.mode === 'FIXED') {
            acc.additive += sign * magnitude.amount
          } else if (magnitude.mode === 'PERCENTAGE') {
            const amount = magnitudeAmount(magnitude, baseValue)
            if (amount !== null) acc.percentOfBase += sign * amount
          }
        }

        accumulators.set(stat, acc)
      }

      activeEffects.push({
        sourceSlot: product.slot,
        sourceProductId: product.productId,
        sourceProductReference: product.reference,
        kind: effect.kind,
        target: effect.target,
        ...(effect.statistic === undefined ? {} : { statistic: effect.statistic }),
        ...(effect.operation === undefined ? {} : { operation: effect.operation }),
        ...(effect.magnitude === undefined ? {} : { magnitude: effect.magnitude }),
        ...(effect.durationTurns === undefined ? {} : { durationTurns: effect.durationTurns }),
        hasActivationCondition: effect.hasActivationCondition,
        appliedToStats: applied,
        raw: effect.raw,
      })
    }
  }

  const effectiveNumeric = (stat: EffectStatistic, base: number): number => {
    const acc = accumulators.get(stat)
    if (acc === undefined) return base

    if (acc.setValue !== null) return roundClampNonNegative(acc.setValue)

    let value = base + acc.additive + acc.percentOfBase
    for (const factor of acc.multipliers) value *= factor

    return roundClampNonNegative(value)
  }

  const basePower = baseStats.power
  const baseHealth = baseStats.health
  const baseDefense = baseStats.defense
  const baseAttack = baseStats.attack

  const effPower = effectiveNumeric('POWER', basePower)
  const effHealth = effectiveNumeric('HEALTH', baseHealth)
  const effDefense = effectiveNumeric('DEFENSE', baseDefense)
  const effAttack = baseAttack === null ? null : effectiveNumeric('ATTACK', baseAttack)

  const deltas: NumericStatDelta[] = []
  const pushDelta = (statistic: EffectStatistic, base: number, effective: number): void => {
    if (effective !== base) deltas.push({ statistic, base, effective, delta: effective - base })
  }
  pushDelta('POWER', basePower, effPower)
  pushDelta('HEALTH', baseHealth, effHealth)
  pushDelta('DEFENSE', baseDefense, effDefense)
  if (baseAttack !== null && effAttack !== null) pushDelta('ATTACK', baseAttack, effAttack)

  return {
    level,
    baseStats: {
      power: catalogBaseStats.power,
      health: catalogBaseStats.health,
      defense: catalogBaseStats.defense,
      attack: catalogBaseStats.attack,
      damage: catalogBaseStats.damage,
      healing: catalogBaseStats.healing,
    },
    levelStats: {
      power: basePower,
      health: baseHealth,
      defense: baseDefense,
      attack: baseAttack,
      damage: baseStats.damage,
      healing: baseStats.healing,
    },
    effectiveStats: {
      power: effPower,
      health: effHealth,
      defense: effDefense,
      attack: effAttack,
      // El dano y la sanacion base pueden ser dados: HU-28 no los colapsa a un
      // numero. Se conservan tal cual; su modificacion por efectos vive en
      // `activeEffects` para el motor de combate.
      damage: baseStats.damage,
      healing: baseStats.healing,
    },
    deltas,
    activeEffects,
  }
}

const baseValueOf = (stat: EffectStatistic, baseStats: HeroBaseStats): number => {
  switch (stat) {
    case 'POWER':
      return baseStats.power
    case 'HEALTH':
      return baseStats.health
    case 'DEFENSE':
      return baseStats.defense
    case 'ATTACK':
      return baseStats.attack ?? 0
    default:
      return 0
  }
}
