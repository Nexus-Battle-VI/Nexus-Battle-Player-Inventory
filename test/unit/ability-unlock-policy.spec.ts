import {
  ABILITY_UNLOCK_LEVELS,
  abilityUnlockLevel,
} from '../../src/domain/policies/AbilityUnlockPolicy'

describe('EN-031 — AbilityUnlockPolicy', () => {
  it('desbloquea por posicion en los niveles 1, 3 y 5', () => {
    expect(ABILITY_UNLOCK_LEVELS).toEqual([1, 3, 5])
    expect([0, 1, 2].map(abilityUnlockLevel)).toEqual([1, 3, 5])
  })

  it('una cuarta habilidad o posterior queda en el ultimo escalon, nunca antes que la tercera', () => {
    expect(abilityUnlockLevel(3)).toBe(5)
    expect(abilityUnlockLevel(10)).toBe(5)
  })

  it('rechaza posiciones que no son enteros no negativos', () => {
    expect(() => abilityUnlockLevel(-1)).toThrow(RangeError)
    expect(() => abilityUnlockLevel(1.5)).toThrow(RangeError)
    expect(() => abilityUnlockLevel(Number.NaN)).toThrow(RangeError)
  })
})
