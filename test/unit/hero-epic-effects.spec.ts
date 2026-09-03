import { DomainError } from '../../src/domain/errors/DomainError'
import {
  computeHeroEffectsWithEpic,
  parseEpicAttributes,
} from '../../src/domain/policies/hero-epic-effects'
import {
  parseEquippableAttributes,
  parseHeroAttributes,
} from '../../src/domain/value-objects/equipment-effects'

// Contrato de Catalog v1; las fixtures funcionales compuestas de Tabla 20
// se prueban aparte y no se presentan como payloads que Catalog ya admita.
const generalEffect = Object.freeze({
  kind: 'STAT_MODIFIER',
  target: 'OPPONENT',
  statistic: 'POWER',
  operation: 'DECREASE',
  magnitude: Object.freeze({ mode: 'FIXED', amount: 1 }),
  stackable: false,
})
const specificEffect = Object.freeze({
  kind: 'IMMUNITY',
  target: 'SELF',
  immunityCode: 'DAMAGE',
  durationTurns: 1,
  stackable: false,
})
const epicAttributes = Object.freeze({
  schemaVersion: '1',
  values: Object.freeze({
    kind: 'EPICA',
    compatibleHeroSubtype: 'MAGO_HIELO',
    generalEffect,
    specificEffect,
    powerCost: 0,
    cooldownTurns: 2,
  }),
})
const hero = (heroSubtype = 'MAGO_HIELO') =>
  parseHeroAttributes({
    schemaVersion: '1',
    values: {
      kind: 'HEROE',
      heroSubtype,
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'DICE', count: 1, sides: 6 },
    },
  })

describe('adaptacion de EPICA Catalog v1 a HU-31', () => {
  it('mapea los nombres del contrato sin perder metadatos ni referencias', () => {
    const epic = parseEpicAttributes(epicAttributes)
    expect(epic).toEqual({
      associatedHeroType: 'MAGO_HIELO',
      baseEffect: generalEffect,
      additionalEffect: specificEffect,
    })
    expect(epic.baseEffect).toBe(generalEffect)
    expect(epic.additionalEffect).toBe(specificEffect)
  })

  it('traduce generalEffect omitido al null explicito del resolver (Medico)', () => {
    const revive = Object.freeze({
      kind: 'REVIVE',
      target: 'ALLY',
      magnitude: Object.freeze({ mode: 'PERCENTAGE', basisPoints: 2000 }),
      activationCondition: Object.freeze({ kind: 'ON_LINKED_ALLY_DEATH' }),
      stackable: false,
    })
    const epic = parseEpicAttributes({
      schemaVersion: '1',
      values: {
        kind: 'EPICA',
        compatibleHeroSubtype: 'MEDICO',
        specificEffect: revive,
        powerCost: 0,
        cooldownTurns: 2,
      },
    })
    expect(epic).toEqual({
      associatedHeroType: 'MEDICO',
      baseEffect: null,
      additionalEffect: revive,
    })
    expect(epic.additionalEffect).toBe(revive)
  })

  it.each([null, undefined, [], 'epica', 1, {}, { values: epicAttributes.values }])(
    'rechaza un sobre invalido: %j',
    (attributes) => {
      expect(() => parseEpicAttributes(attributes)).toThrow(DomainError)
    },
  )

  it.each([
    { ...epicAttributes, schemaVersion: '2' },
    { ...epicAttributes, schemaVersion: 1 },
    { schemaVersion: '1', values: [] },
    { schemaVersion: '1', values: { ...epicAttributes.values, kind: 'ITEM' } },
    { schemaVersion: '1', values: { ...epicAttributes.values, compatibleHeroSubtype: 'MAGO' } },
    { schemaVersion: '1', values: { ...epicAttributes.values, compatibleHeroSubtype: null } },
    { schemaVersion: '1', values: { ...epicAttributes.values, generalEffect: null } },
    { schemaVersion: '1', values: { ...epicAttributes.values, generalEffect: undefined } },
    { schemaVersion: '1', values: { ...epicAttributes.values, generalEffect: [] } },
    { schemaVersion: '1', values: { ...epicAttributes.values, specificEffect: undefined } },
    { schemaVersion: '1', values: { ...epicAttributes.values, specificEffect: null } },
    { schemaVersion: '1', values: { ...epicAttributes.values, specificEffect: [] } },
    { schemaVersion: '1', values: { ...epicAttributes.values, specificEffect: 'bonus' } },
  ])('rechaza campos incompatibles sin interpretarlos: %j', (attributes) => {
    expect(() => parseEpicAttributes(attributes)).toThrow(DomainError)
  })
})

describe('composicion pura con el calculo HU-28', () => {
  const equipment = Object.freeze([
    Object.freeze({
      slot: 'WEAPON_1',
      productId: 'weapon-id',
      reference: 'ARMA-001',
      attributes: parseEquippableAttributes({
        schemaVersion: '1',
        values: {
          kind: 'ARMA',
          compatibilityScope: 'ALL_HEROES',
          effects: [
            {
              kind: 'STAT_MODIFIER',
              target: 'SELF',
              statistic: 'ATTACK',
              operation: 'INCREASE',
              magnitude: { mode: 'FIXED', amount: 2 },
              stackable: false,
            },
          ],
        },
      }),
    }),
  ])

  it('preserva el recalculo de HU-28 y resuelve las dos capas aparte sin ejecutar combate', () => {
    const heroView = hero()
    Object.freeze(heroView.baseStats)
    Object.freeze(heroView)
    const before = structuredClone({ heroView, equipment, epicAttributes })
    const result = computeHeroEffectsWithEpic(heroView, equipment, epicAttributes)

    expect(result.baseStats).toEqual({
      power: 5,
      health: 40,
      defense: 8,
      attack: 10,
      damage: { mode: 'DICE', count: 1, sides: 6 },
      healing: null,
    })
    expect(result.effectiveStats).toEqual({ ...result.baseStats, attack: 12 })
    expect(result.deltas).toEqual([{ statistic: 'ATTACK', base: 10, effective: 12, delta: 2 }])
    expect(result.activeEffects).toHaveLength(1)
    expect(result.activeEffects[0]).toMatchObject({
      sourceSlot: 'WEAPON_1',
      sourceProductId: 'weapon-id',
      appliedToStats: true,
    })
    expect(result.epicEffects).toEqual({
      baseApplied: generalEffect,
      additionalApplied: specificEffect,
      combined: [generalEffect, specificEffect],
    })
    expect(result.epicEffects.combined[0]).toBe(generalEffect)
    expect(result.epicEffects.combined[1]).toBe(specificEffect)
    expect(computeHeroEffectsWithEpic(heroView, equipment, epicAttributes)).toEqual(result)
    expect({ heroView, equipment, epicAttributes }).toEqual(before)
  })

  it('un subtipo distinto solo recibe la base de la epica', () => {
    expect(computeHeroEffectsWithEpic(hero('MAGO_FUEGO'), [], epicAttributes).epicEffects).toEqual({
      baseApplied: generalEffect,
      additionalApplied: null,
      combined: [generalEffect],
    })
  })

  it('retirar la epica no altera las estadisticas del equipamiento ni deja efectos residuales', () => {
    const withEpic = computeHeroEffectsWithEpic(hero(), equipment, epicAttributes)
    const withoutEpic = computeHeroEffectsWithEpic(hero(), equipment, null)
    const empty = { baseApplied: null, additionalApplied: null, combined: [] }
    expect(withoutEpic).toEqual({ ...withEpic, epicEffects: empty })
    expect(computeHeroEffectsWithEpic(hero(), equipment)).toEqual(withoutEpic)
  })

  it.each([
    {
      subtype: 'CHAMAN',
      effect: {
        kind: 'HEALING',
        target: 'ALLIED_GROUP',
        magnitude: { mode: 'DICE', count: 4, sides: 8 },
        stackable: false,
      },
    },
    {
      subtype: 'MEDICO',
      effect: {
        kind: 'REVIVE',
        target: 'ALLY',
        magnitude: { mode: 'PERCENTAGE', basisPoints: 2000 },
        activationCondition: { kind: 'ON_LINKED_ALLY_DEATH' },
        stackable: false,
      },
    },
  ])('compone una epica sin base de $subtype', ({ subtype, effect }) => {
    const attributes = {
      schemaVersion: '1',
      values: {
        kind: 'EPICA',
        compatibleHeroSubtype: subtype,
        specificEffect: effect,
        powerCost: 0,
        cooldownTurns: 2,
      },
    }
    expect(computeHeroEffectsWithEpic(hero(subtype), [], attributes).epicEffects).toEqual({
      baseApplied: null,
      additionalApplied: effect,
      combined: [effect],
    })
    expect(computeHeroEffectsWithEpic(hero(), [], attributes).epicEffects).toEqual({
      baseApplied: null,
      additionalApplied: null,
      combined: [],
    })
  })

  it('rechaza un subtipo de heroe invalido incluso sin epica', () => {
    expect(() => computeHeroEffectsWithEpic(hero('DESCONOCIDO'), [], null)).toThrow(DomainError)
  })
})
