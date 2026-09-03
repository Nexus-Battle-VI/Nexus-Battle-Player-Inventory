import { computeEffectiveStats } from '../../src/domain/services/effective-stats'
import {
  parseEquippableAttributes,
  parseHeroAttributes,
  type HeroBaseStats,
} from '../../src/domain/value-objects/equipment-effects'

const heroEnvelope = {
  schemaVersion: '1',
  values: {
    kind: 'HEROE',
    heroSubtype: 'GUERRERO_TANQUE',
    basePower: 5,
    baseHealth: 40,
    baseDefense: 8,
    baseAttack: { mode: 'FIXED', amount: 10 },
    baseDamage: { mode: 'DICE', count: 1, sides: 6 },
    abilities: ['a', 'b', 'c'],
  },
}

const baseStats = (): HeroBaseStats => parseHeroAttributes(heroEnvelope).baseStats

const weapon = (effects: unknown[]): ReturnType<typeof parseEquippableAttributes> =>
  parseEquippableAttributes({
    schemaVersion: '1',
    values: { kind: 'ARMA', compatibilityScope: 'ALL_HEROES', effects },
  })

const statModifier = (
  statistic: string,
  operation: string,
  magnitude: unknown,
  extra: Record<string, unknown> = {},
): unknown => ({
  kind: 'STAT_MODIFIER',
  target: 'SELF',
  statistic,
  operation,
  magnitude,
  stackable: false,
  ...extra,
})

const equippedWith = (
  effects: unknown[],
  slot = 'WEAPON_1',
): Parameters<typeof computeEffectiveStats>[1][number] => ({
  slot,
  productId: `pid-${slot}`,
  reference: `ref-${slot}`,
  attributes: weapon(effects),
})

describe('parseHeroAttributes', () => {
  it('extrae poder, vida, defensa, ataque fijo y dano en dados', () => {
    const view = parseHeroAttributes(heroEnvelope)
    expect(view.heroSubtype).toBe('GUERRERO_TANQUE')
    expect(view.baseStats).toEqual({
      power: 5,
      health: 40,
      defense: 8,
      attack: 10,
      damage: { mode: 'DICE', count: 1, sides: 6 },
      healing: null,
    })
  })

  it('rechaza un sobre que no es de un heroe', () => {
    expect(() => parseHeroAttributes({ schemaVersion: '1', values: { kind: 'ARMA' } })).toThrow()
  })
})

describe('computeEffectiveStats (RF-28, CA-08)', () => {
  it('base + un modificador +1 de ataque da efectiva = base + 1', () => {
    const result = computeEffectiveStats(baseStats(), [
      equippedWith([statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 1 })]),
    ])

    expect(result.baseStats.attack).toBe(10)
    expect(result.effectiveStats.attack).toBe(11)
    expect(result.deltas).toContainEqual({
      statistic: 'ATTACK',
      base: 10,
      effective: 11,
      delta: 1,
    })
  })

  it('acumula varios modificadores de la misma estadistica', () => {
    const result = computeEffectiveStats(baseStats(), [
      equippedWith([statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 2 })], 'HELMET'),
      equippedWith([statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 3 })], 'CHEST'),
    ])

    expect(result.effectiveStats.defense).toBe(8 + 2 + 3)
  })

  it('una estadistica sin modificadores permanece igual a la base', () => {
    const result = computeEffectiveStats(baseStats(), [
      equippedWith([statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 4 })]),
    ])

    expect(result.effectiveStats.health).toBe(result.baseStats.health)
    expect(result.deltas.map((d) => d.statistic)).not.toContain('HEALTH')
  })

  it('recalcula desde la base: aplicar el mismo loadout dos veces da el mismo resultado', () => {
    const loadout = [
      equippedWith([statModifier('HEALTH', 'INCREASE', { mode: 'FIXED', amount: 10 })]),
    ]
    const first = computeEffectiveStats(baseStats(), loadout)
    const second = computeEffectiveStats(baseStats(), loadout)

    expect(first.effectiveStats).toEqual(second.effectiveStats)
    expect(second.effectiveStats.health).toBe(50)
  })

  it('aplica un porcentaje sobre el valor base y un multiplicador', () => {
    const pct = computeEffectiveStats(baseStats(), [
      equippedWith([statModifier('HEALTH', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 5000 })]),
    ])
    expect(pct.effectiveStats.health).toBe(60) // 40 + 50%

    const mult = computeEffectiveStats(baseStats(), [
      equippedWith([statModifier('DEFENSE', 'MULTIPLY', { mode: 'FIXED', amount: 2 })]),
    ])
    expect(mult.effectiveStats.defense).toBe(16)
  })

  it('un SET fija el valor con independencia de la base', () => {
    const result = computeEffectiveStats(baseStats(), [
      equippedWith([statModifier('ATTACK', 'SET', { mode: 'FIXED', amount: 99 })]),
    ])
    expect(result.effectiveStats.attack).toBe(99)
  })

  it('NO aplica —pero conserva estructurado— un efecto al oponente', () => {
    const result = computeEffectiveStats(baseStats(), [
      equippedWith([
        statModifier('ATTACK', 'DECREASE', { mode: 'FIXED', amount: 1 }, { target: 'OPPONENT' }),
      ]),
    ])

    expect(result.effectiveStats.attack).toBe(10)
    expect(result.activeEffects).toHaveLength(1)
    expect(result.activeEffects[0]).toMatchObject({
      target: 'OPPONENT',
      appliedToStats: false,
      sourceSlot: 'WEAPON_1',
    })
  })

  it('NO aplica un efecto por turnos ni uno condicional, pero los conserva', () => {
    const result = computeEffectiveStats(baseStats(), [
      equippedWith([
        statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 5 }, { durationTurns: 2 }),
        statModifier(
          'ATTACK',
          'INCREASE',
          { mode: 'FIXED', amount: 5 },
          {
            activationCondition: { kind: 'PREVIOUS_TURN_DAMAGE_RECEIVED' },
          },
        ),
      ]),
    ])

    expect(result.effectiveStats.defense).toBe(8)
    expect(result.effectiveStats.attack).toBe(10)
    expect(result.activeEffects.every((e) => !e.appliedToStats)).toBe(true)
    expect(result.activeEffects).toHaveLength(2)
  })

  it('conserva un efecto DAMAGE/HEALING como estructurado sin ejecutarlo', () => {
    const result = computeEffectiveStats(baseStats(), [
      equippedWith([
        { kind: 'DAMAGE', target: 'OPPONENT', magnitude: { mode: 'DICE', count: 2, sides: 6 } },
        { kind: 'HEALING', target: 'SELF', magnitude: { mode: 'FIXED', amount: 3 } },
      ]),
    ])

    expect(result.effectiveStats.damage).toEqual(result.baseStats.damage)
    expect(result.activeEffects.map((e) => e.kind).sort()).toEqual(['DAMAGE', 'HEALING'])
    expect(result.activeEffects.every((e) => !e.appliedToStats)).toBe(true)
  })

  it('no deja una estadistica efectiva por debajo de cero', () => {
    const result = computeEffectiveStats(baseStats(), [
      equippedWith([statModifier('DEFENSE', 'DECREASE', { mode: 'FIXED', amount: 999 })]),
    ])
    expect(result.effectiveStats.defense).toBe(0)
  })
})
