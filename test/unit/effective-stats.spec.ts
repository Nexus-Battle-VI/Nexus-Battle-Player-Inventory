import {
  LEVEL_SCALED_STATS,
  computeEffectiveStats,
  scaleBaseStatsByLevel,
} from '../../src/domain/services/effective-stats'
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
    const result = computeEffectiveStats(
      baseStats(),
      [equippedWith([statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 1 })])],
      1,
    )

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
    const result = computeEffectiveStats(
      baseStats(),
      [
        equippedWith([statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 2 })], 'HELMET'),
        equippedWith([statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 3 })], 'CHEST'),
      ],
      1,
    )

    expect(result.effectiveStats.defense).toBe(8 + 2 + 3)
  })

  it('una estadistica sin modificadores permanece igual a la base', () => {
    const result = computeEffectiveStats(
      baseStats(),
      [equippedWith([statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 4 })])],
      1,
    )

    expect(result.effectiveStats.health).toBe(result.baseStats.health)
    expect(result.deltas.map((d) => d.statistic)).not.toContain('HEALTH')
  })

  it('recalcula desde la base: aplicar el mismo loadout dos veces da el mismo resultado', () => {
    const loadout = [
      equippedWith([statModifier('HEALTH', 'INCREASE', { mode: 'FIXED', amount: 10 })]),
    ]
    const first = computeEffectiveStats(baseStats(), loadout, 1)
    const second = computeEffectiveStats(baseStats(), loadout, 1)

    expect(first.effectiveStats).toEqual(second.effectiveStats)
    expect(second.effectiveStats.health).toBe(50)
  })

  it('aplica un porcentaje sobre el valor base y un multiplicador', () => {
    const pct = computeEffectiveStats(
      baseStats(),
      [
        equippedWith([
          statModifier('HEALTH', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 5000 }),
        ]),
      ],
      1,
    )
    expect(pct.effectiveStats.health).toBe(60) // 40 + 50%

    const mult = computeEffectiveStats(
      baseStats(),
      [equippedWith([statModifier('DEFENSE', 'MULTIPLY', { mode: 'FIXED', amount: 2 })])],
      1,
    )
    expect(mult.effectiveStats.defense).toBe(16)
  })

  it('un SET fija el valor con independencia de la base', () => {
    const result = computeEffectiveStats(
      baseStats(),
      [equippedWith([statModifier('ATTACK', 'SET', { mode: 'FIXED', amount: 99 })])],
      1,
    )
    expect(result.effectiveStats.attack).toBe(99)
  })

  it('NO aplica —pero conserva estructurado— un efecto al oponente', () => {
    const result = computeEffectiveStats(
      baseStats(),
      [
        equippedWith([
          statModifier('ATTACK', 'DECREASE', { mode: 'FIXED', amount: 1 }, { target: 'OPPONENT' }),
        ]),
      ],
      1,
    )

    expect(result.effectiveStats.attack).toBe(10)
    expect(result.activeEffects).toHaveLength(1)
    expect(result.activeEffects[0]).toMatchObject({
      target: 'OPPONENT',
      appliedToStats: false,
      sourceSlot: 'WEAPON_1',
    })
  })

  it('NO aplica un efecto por turnos ni uno condicional, pero los conserva', () => {
    const result = computeEffectiveStats(
      baseStats(),
      [
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
      ],
      1,
    )

    expect(result.effectiveStats.defense).toBe(8)
    expect(result.effectiveStats.attack).toBe(10)
    expect(result.activeEffects.every((e) => !e.appliedToStats)).toBe(true)
    expect(result.activeEffects).toHaveLength(2)
  })

  it('conserva un efecto DAMAGE/HEALING como estructurado sin ejecutarlo', () => {
    const result = computeEffectiveStats(
      baseStats(),
      [
        equippedWith([
          { kind: 'DAMAGE', target: 'OPPONENT', magnitude: { mode: 'DICE', count: 2, sides: 6 } },
          { kind: 'HEALING', target: 'SELF', magnitude: { mode: 'FIXED', amount: 3 } },
        ]),
      ],
      1,
    )

    expect(result.effectiveStats.damage).toEqual(result.baseStats.damage)
    expect(result.activeEffects.map((e) => e.kind).sort()).toEqual(['DAMAGE', 'HEALING'])
    expect(result.activeEffects.every((e) => !e.appliedToStats)).toBe(true)
  })

  it('no deja una estadistica efectiva por debajo de cero', () => {
    const result = computeEffectiveStats(
      baseStats(),
      [equippedWith([statModifier('DEFENSE', 'DECREASE', { mode: 'FIXED', amount: 999 })])],
      1,
    )
    expect(result.effectiveStats.defense).toBe(0)
  })
})

/**
 * HU-08, CA-06: el nivel actua como factor multiplicador sobre las estadisticas.
 *
 * ORDEN FIJADO (decision documentada en docs/hu-08-progresion.md):
 *   efectiva = (base x nivel) + equipamiento      -- NO (base + equipamiento) x nivel
 * Ejemplo del PDF: un mago de fuego de nivel 1 tiene ataque base 10; de nivel 3, 30.
 */
describe('computeEffectiveStats — el nivel multiplica las estadisticas (CA-06)', () => {
  const at = (level: number, effects: unknown[] = []) =>
    computeEffectiveStats(baseStats(), effects.length === 0 ? [] : [equippedWith(effects)], level)

  it('nivel 1: el factor es 1 y el resultado es el de siempre', () => {
    const result = at(1)

    expect(result.level).toBe(1)
    expect(result.levelStats).toEqual(result.baseStats)
    expect(result.effectiveStats).toEqual(result.baseStats)
  })

  it('ejemplo del PDF: ataque base 10 en nivel 1 pasa a 30 en nivel 3', () => {
    expect(at(1).effectiveStats.attack).toBe(10)
    expect(at(3).effectiveStats.attack).toBe(30)
    expect(at(3).levelStats.attack).toBe(30)
  })

  it('multiplica poder, vida, defensa y ataque en cada nivel de 1 a 8', () => {
    for (let level = 1; level <= 8; level += 1) {
      const result = at(level)

      expect(result.effectiveStats).toMatchObject({
        power: 5 * level,
        health: 40 * level,
        defense: 8 * level,
        attack: 10 * level,
      })
    }
  })

  it('la base de Catalog (nivel 1) NO se muta: baseStats sigue siendo la de Catalog', () => {
    const result = at(8)

    expect(result.baseStats).toMatchObject({ power: 5, health: 40, defense: 8, attack: 10 })
    expect(result.levelStats.attack).toBe(80)
  })

  it('ORDEN: (base x nivel) + equipamiento, y no (base + equipamiento) x nivel', () => {
    // +2 de ataque en nivel 3: (10 x 3) + 2 = 32; el otro orden daria (10 + 2) x 3 = 36.
    const result = at(3, [statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 2 })])

    expect(result.effectiveStats.attack).toBe(32)
    expect(result.effectiveStats.attack).not.toBe(36)
  })

  it('el equipamiento fijo NO se multiplica por el nivel', () => {
    const level1 = at(1, [statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 4 })])
    const level5 = at(5, [statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 4 })])

    expect(level1.effectiveStats.defense).toBe(12)
    expect(level5.effectiveStats.defense).toBe(8 * 5 + 4)
  })

  it('un porcentaje se calcula sobre la base YA escalada por el nivel', () => {
    // Vida 40 en nivel 2 = 80; +50 % de 80 = 120 (y no 80 + 20).
    const result = at(2, [
      statModifier('HEALTH', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 5000 }),
    ])

    expect(result.effectiveStats.health).toBe(120)
  })

  it('un multiplicador del equipamiento opera sobre la base escalada', () => {
    const result = at(3, [statModifier('DEFENSE', 'MULTIPLY', { mode: 'FIXED', amount: 2 })])

    expect(result.effectiveStats.defense).toBe(48) // (8 x 3) x 2
  })

  it('un SET fija el valor con independencia del nivel', () => {
    expect(
      at(6, [statModifier('ATTACK', 'SET', { mode: 'FIXED', amount: 99 })]).effectiveStats.attack,
    ).toBe(99)
  })

  it('los deltas miden SOLO el equipamiento, no el nivel', () => {
    const result = at(3, [statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 2 })])

    expect(result.deltas).toEqual([{ statistic: 'ATTACK', base: 30, effective: 32, delta: 2 }])
    expect(at(3).deltas).toEqual([])
  })

  it('daño y sanacion (dados o valores fijos) NO se escalan: el PO no ha definido esa regla', () => {
    const result = at(4)

    expect(result.effectiveStats.damage).toEqual({ mode: 'DICE', count: 1, sides: 6 })
    expect(result.levelStats.damage).toEqual({ mode: 'DICE', count: 1, sides: 6 })
    expect(result.effectiveStats.healing).toBeNull()
  })

  it('un heroe sin ataque (sanador) mantiene ataque nulo en cualquier nivel', () => {
    const healer = { ...baseStats(), attack: null }

    expect(scaleBaseStatsByLevel(healer, 5).attack).toBeNull()
    expect(computeEffectiveStats(healer, [], 5).effectiveStats.attack).toBeNull()
  })

  it('escala exactamente las estadisticas declaradas en LEVEL_SCALED_STATS', () => {
    expect([...LEVEL_SCALED_STATS].sort()).toEqual(['ATTACK', 'DEFENSE', 'HEALTH', 'POWER'])
  })

  it('es determinista y pura: no muta la entrada', () => {
    const base = baseStats()
    const snapshot = JSON.stringify(base)

    expect(computeEffectiveStats(base, [], 4)).toEqual(computeEffectiveStats(base, [], 4))
    expect(JSON.stringify(base)).toBe(snapshot)
  })

  it('rechaza un nivel fuera de 1..8 o no entero en lugar de escalar con un dato invalido', () => {
    for (const invalid of [0, -1, 9, 2.5, Number.NaN, '3', null, undefined]) {
      expect(() => computeEffectiveStats(baseStats(), [], invalid as number)).toThrow()
    }
  })
})
