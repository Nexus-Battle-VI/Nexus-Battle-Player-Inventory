import { DomainError } from '../../src/domain/errors/DomainError'
import { applyEpicEffects, VALID_HERO_TYPES } from '../../src/domain/policies/EpicEffectPolicy'
import type {
  ApplyEpicEffectsInput,
  EpicDefinition,
  EpicEffect,
} from '../../src/domain/policies/EpicEffectPolicy'
import { HERO_SUBTYPES } from '../../src/domain/value-objects/hero-subtype'
import { TABLE_20_EPICS } from '../fixtures/epic-table20'

const tankEpic = TABLE_20_EPICS.GUERRERO_TANQUE.definition
const table20 = Object.values(TABLE_20_EPICS)
const noMatchCases = table20.flatMap(({ name, definition }) =>
  HERO_SUBTYPES.filter((heroType) => heroType !== definition.associatedHeroType).map(
    (heroType) => ({
      name,
      definition,
      heroType,
    }),
  ),
)

const invalidDefinition = (value: unknown): EpicDefinition => value as EpicDefinition

describe('EpicEffectPolicy (RF-31)', () => {
  it('comparte el registro canonico de HU-28, sin catalogo provisional paralelo', () => {
    expect(VALID_HERO_TYPES).toBe(HERO_SUBTYPES)
  })

  it.each(table20)('match: conserva todas las capas de $name en su subtipo', ({ definition }) => {
    const result = applyEpicEffects({ heroType: definition.associatedHeroType, epic: definition })
    const expectedLayers =
      definition.baseEffect === null
        ? [definition.additionalEffect]
        : [definition.baseEffect, definition.additionalEffect]

    expect(result).toEqual({
      baseApplied: definition.baseEffect,
      additionalApplied: definition.additionalEffect,
      combined: expectedLayers,
    })
    expect(result.additionalApplied).toBe(definition.additionalEffect)
    expect(result.baseApplied).toBe(definition.baseEffect)
  })

  it.each(noMatchCases)(
    'no-match: $name en $heroType conserva solo el general',
    ({ definition, heroType }) => {
      expect(applyEpicEffects({ heroType, epic: definition })).toEqual({
        baseApplied: definition.baseEffect,
        additionalApplied: null,
        combined: definition.baseEffect === null ? [] : [definition.baseEffect],
      })
    },
  )

  it.each(HERO_SUBTYPES)('sin epica no aplica efectos a %s', (heroType) => {
    const expected = { baseApplied: null, additionalApplied: null, combined: [] }

    expect(applyEpicEffects({ heroType, epic: null })).toEqual(expected)
    expect(applyEpicEffects({ heroType })).toEqual(expected)
    expect(applyEpicEffects({ heroType, epic: undefined })).toEqual(expected)
  })

  it('P4: no reemplaza el general ni pierde los componentes del especifico', () => {
    expect(applyEpicEffects({ heroType: 'GUERRERO_TANQUE', epic: tankEpic })).toEqual({
      baseApplied: { attack: 1 },
      additionalApplied: { damage: 4, criticalPercent: 2 },
      combined: [{ attack: 1 }, { damage: 4, criticalPercent: 2 }],
    })
  })

  it('preserva recuperacion por dados y el bono compuesto de Segundo impulso', () => {
    expect(
      applyEpicEffects({
        heroType: 'GUERRERO_ARMAS',
        epic: TABLE_20_EPICS.GUERRERO_ARMAS.definition,
      }),
    ).toEqual({
      baseApplied: { recoverHealthDice: { count: 1, sides: 4 } },
      additionalApplied: { health: 3, criticalPercent: 5 },
      combined: [{ recoverHealthDice: { count: 1, sides: 4 } }, { health: 3, criticalPercent: 5 }],
    })
  })

  it('Te changua conserva solo la sanacion grupal 4d8 con match y ninguna sin match', () => {
    const epic = TABLE_20_EPICS.CHAMAN.definition
    const specific = { healingTarget: 'ALL', healingDice: { count: 4, sides: 8 } }

    expect(applyEpicEffects({ heroType: 'CHAMAN', epic })).toEqual({
      baseApplied: null,
      additionalApplied: specific,
      combined: [specific],
    })
    expect(applyEpicEffects({ heroType: 'MEDICO', epic })).toEqual({
      baseApplied: null,
      additionalApplied: null,
      combined: [],
    })
  })

  it('Reanimador 3000 conserva condicion, objetivo y 20% sin ejecutar reanimacion', () => {
    const epic = TABLE_20_EPICS.MEDICO.definition
    const specific = {
      linkedTarget: 'COMPANION',
      trigger: 'LINKED_COMPANION_DIES',
      revivedHealthPercent: 20,
    }

    expect(applyEpicEffects({ heroType: 'MEDICO', epic })).toEqual({
      baseApplied: null,
      additionalApplied: specific,
      combined: [specific],
    })
    expect(applyEpicEffects({ heroType: 'CHAMAN', epic })).toEqual({
      baseApplied: null,
      additionalApplied: null,
      combined: [],
    })
  })

  it.each([
    undefined,
    null,
    '',
    ' ',
    'guerrero',
    'Guerrero Tanque',
    'GUERRERO',
    'TANQUE',
    'MAGO_RAYO',
    1,
    {},
    [],
  ])('rechaza el tipo de heroe %p incluso sin epica', (heroType) => {
    expect(() => applyEpicEffects({ heroType, epic: null })).toThrow(DomainError)
    expect(() => applyEpicEffects({ heroType, epic: tankEpic })).toThrow(
      /heroType debe ser un subtipo canonico valido/,
    )
  })

  it.each([undefined, null, '', 'guerrero', 'MAGO', 1, {}, []])(
    'rechaza associatedHeroType %p',
    (associatedHeroType) => {
      expect(() =>
        applyEpicEffects({
          heroType: 'GUERRERO_TANQUE',
          epic: { ...tankEpic, associatedHeroType },
        }),
      ).toThrow(/associatedHeroType debe ser un subtipo canonico valido/)
    },
  )

  it('rechaza baseEffect ausente aunque el heroe no coincida', () => {
    expect(() =>
      applyEpicEffects({
        heroType: 'MAGO_FUEGO',
        epic: {
          associatedHeroType: 'GUERRERO_TANQUE',
          additionalEffect: tankEpic.additionalEffect,
        },
      }),
    ).toThrow(/debe declarar baseEffect/)
  })

  it.each([undefined, '', 0, false, []])(
    'rechaza baseEffect %p; solo null representa No aplica',
    (baseEffect) => {
      expect(() =>
        applyEpicEffects({
          heroType: 'GUERRERO_TANQUE',
          epic: invalidDefinition({ ...tankEpic, baseEffect }),
        }),
      ).toThrow(/baseEffect debe ser un objeto de efecto o null/)
    },
  )

  it('rechaza additionalEffect ausente incluso sin coincidencia', () => {
    expect(() =>
      applyEpicEffects({
        heroType: 'MEDICO',
        epic: { associatedHeroType: 'GUERRERO_TANQUE', baseEffect: tankEpic.baseEffect },
      }),
    ).toThrow(/debe declarar additionalEffect como un objeto/)
  })

  it.each([undefined, null, '', 0, false, []])(
    'rechaza additionalEffect %p',
    (additionalEffect) => {
      expect(() =>
        applyEpicEffects({
          heroType: 'GUERRERO_TANQUE',
          epic: invalidDefinition({ ...tankEpic, additionalEffect }),
        }),
      ).toThrow(/debe declarar additionalEffect como un objeto/)
    },
  )

  it.each([null, undefined, [], '', 1])('rechaza entrada %p con error de dominio', (input) => {
    expect(() => applyEpicEffects(input as unknown as ApplyEpicEffectsInput)).toThrow(DomainError)
  })

  it.each([[], '', 0, false])('rechaza epica %p con error de dominio', (epic) => {
    expect(() => applyEpicEffects({ heroType: 'CHAMAN', epic: invalidDefinition(epic) })).toThrow(
      /epic debe ser una definicion/,
    )
  })

  it('no acepta propiedades de efecto heredadas como contrato declarado', () => {
    const epic = Object.assign(Object.create(tankEpic) as object, {
      associatedHeroType: 'GUERRERO_TANQUE',
    })

    expect(() => applyEpicEffects({ heroType: 'GUERRERO_TANQUE', epic })).toThrow(
      /debe declarar baseEffect/,
    )
  })

  it('es determinista y conserva objetos congelados sin mutar ni compartir la lista de resultado', () => {
    const nested = Object.freeze({ dice: Object.freeze({ count: 4, sides: 8 }) })
    const baseEffect = Object.freeze({ opaque: nested })
    const additionalEffect = Object.freeze({
      opaque: Object.freeze({ health: 3, criticalPercent: 5 }),
    })
    const epic = Object.freeze({
      associatedHeroType: 'GUERRERO_ARMAS',
      baseEffect,
      additionalEffect,
    })
    const input = Object.freeze({ heroType: 'GUERRERO_ARMAS', epic })
    const before = JSON.stringify(input)
    const first = applyEpicEffects(input)
    const second = applyEpicEffects(input)

    expect(first).toEqual({
      baseApplied: baseEffect,
      additionalApplied: additionalEffect,
      combined: [baseEffect, additionalEffect],
    })
    expect(second).toEqual(first)
    expect(first).not.toBe(second)
    expect(first.combined).not.toBe(second.combined)
    expect(first.combined[0]).toBe(baseEffect)
    expect(first.combined[1]).toBe(additionalEffect)
    expect(JSON.stringify(input)).toBe(before)

    ;(first.combined as EpicEffect[]).pop()
    expect(second.combined).toEqual([baseEffect, additionalEffect])
    expect(epic).toEqual({ associatedHeroType: 'GUERRERO_ARMAS', baseEffect, additionalEffect })
  })

  it('acepta una definicion nueva sin decidir su nombre, estructura o aritmetica', () => {
    const baseEffect = { sourceText: 'Efecto general definido por el catalogo de la mision' }
    const additionalEffect = {
      components: [{ unknownMechanic: 'delegada a combate' }, { customData: [2, 3] }],
    }

    expect(
      applyEpicEffects({
        heroType: 'PICARO_VENENO',
        epic: { associatedHeroType: 'PICARO_VENENO', baseEffect, additionalEffect },
      }),
    ).toEqual({
      baseApplied: baseEffect,
      additionalApplied: additionalEffect,
      combined: [baseEffect, additionalEffect],
    })
  })
})
