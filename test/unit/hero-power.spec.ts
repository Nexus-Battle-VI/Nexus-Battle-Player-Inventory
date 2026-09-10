import { DomainError } from '../../src/domain/errors/DomainError'
import {
  getPower,
  regenPower,
  restorePower,
  spendPower,
  type HeroPowerCost,
  type HeroPowerState,
} from '../../src/domain/policies/HeroPowerPolicy'

const power = (heroId: string, current: number, max = 10): HeroPowerState => ({
  heroId,
  current,
  max,
})

const fixed = (amount: number): HeroPowerCost => ({ mode: 'FIXED', amount })

describe('HeroPowerPolicy — HU-11 / RF-11', () => {
  it('consulta y descuenta Poder cuando el saldo cubre exactamente el costo', () => {
    const before = power(' hero-a ', 6)
    const result = spendPower(before, fixed(6))

    expect(result).toEqual({ ok: true, spent: 6, state: power('hero-a', 0) })
    expect(getPower(result.state)).toBe(0)
    expect(before).toEqual(power(' hero-a ', 6))
  })

  it('el ataque básico no consume Poder', () => {
    expect(spendPower(power('hero-a', 3), { mode: 'NONE' })).toEqual({
      ok: true,
      spent: 0,
      state: power('hero-a', 3),
    })
  })

  it('rechaza una habilidad impagable, conserva el saldo y degrada a ataque básico', () => {
    const before = power('hero-a', 3)

    expect(spendPower(before, fixed(4))).toEqual({
      ok: false,
      reason: 'insufficient',
      fallbackAction: 'basic_attack',
      spent: 0,
      state: before,
    })
  })

  it('consume todo el Poder disponible para ALL_AVAILABLE', () => {
    expect(spendPower(power('medico', 7), { mode: 'ALL_AVAILABLE' })).toEqual({
      ok: true,
      spent: 7,
      state: power('medico', 0),
    })
  })

  it.each(['CANCELLED', 'INVALID'] as const)('no descuenta si la acción queda %s', (execution) => {
    const before = power('hero-a', 8)

    expect(spendPower(before, fixed(4), execution)).toEqual({
      ok: false,
      reason: 'not_executed',
      fallbackAction: null,
      spent: 0,
      state: before,
    })
  })

  it('regenera exactamente dos por turno sin superar el máximo', () => {
    expect(regenPower(power('hero-a', 5))).toEqual(power('hero-a', 7))
    expect(regenPower(power('hero-a', 9))).toEqual(power('hero-a', 10))
    expect(regenPower(power('hero-a', 10))).toEqual(power('hero-a', 10))
  })

  it('restaura por completo al finalizar el combate', () => {
    expect(restorePower(power('hero-a', 1))).toEqual(power('hero-a', 10))
  })

  it('mantiene aislado el Poder de dos héroes del mismo jugador', () => {
    const heroA = power('hero-a', 8)
    const heroB = power('hero-b', 8)

    expect(spendPower(heroA, fixed(3))).toEqual({
      ok: true,
      spent: 3,
      state: power('hero-a', 5),
    })
    expect(heroB).toEqual(power('hero-b', 8))
  })

  it.each([
    ['costo fijo cero', () => spendPower(power('hero-a', 5), fixed(0))],
    ['costo negativo', () => spendPower(power('hero-a', 5), fixed(-1))],
    ['costo decimal', () => spendPower(power('hero-a', 5), fixed(1.5))],
    ['costo no finito', () => spendPower(power('hero-a', 5), fixed(Number.NaN))],
    ['saldo negativo', () => getPower(power('hero-a', -1))],
    ['saldo sobre máximo', () => getPower(power('hero-a', 11))],
    ['saldo decimal', () => getPower(power('hero-a', 1.5))],
    ['máximo negativo', () => getPower(power('hero-a', 0, -1))],
    ['máximo decimal', () => getPower(power('hero-a', 0, 1.5))],
    ['héroe vacío', () => getPower(power(' ', 1))],
  ])('rechaza %s', (_case, action) => {
    expect(action).toThrow(DomainError)
  })

  it('rechaza modos de costo y estados de ejecución desconocidos en tiempo de ejecución', () => {
    expect(() =>
      spendPower(power('hero-a', 5), { mode: 'PERCENTAGE' } as unknown as HeroPowerCost),
    ).toThrow(DomainError)
    expect(() =>
      spendPower(power('hero-a', 5), { mode: 'FIXED' } as unknown as HeroPowerCost),
    ).toThrow(DomainError)
    expect(() =>
      spendPower(power('hero-a', 5), fixed(2), 'PENDING' as unknown as 'EXECUTED'),
    ).toThrow(DomainError)
  })
})
