import { HeroEpicSelection } from '../../src/domain/entities/HeroEpicSelection'
import { DomainError } from '../../src/domain/errors/DomainError'

const AT = new Date('2026-10-03T00:00:00.000Z')

describe('HeroEpicSelection (HU-31)', () => {
  it('createEmpty inicia sin epica, version 0', () => {
    const selection = HeroEpicSelection.createEmpty('jugador-1', 'heroe-1')

    expect(selection.isEmpty()).toBe(true)
    expect(selection.epicItemId).toBeNull()
    expect(selection.epicProductId).toBeNull()
    expect(selection.version).toBe(0)
  })

  it('equip() fija la epica y emite hero.epic.equipped', () => {
    const selection = HeroEpicSelection.createEmpty('jugador-1', 'heroe-1')

    selection.equip({
      epicItemId: 'golpe-de-defensa',
      epicProductId: 'pid-golpe-de-defensa',
      occurredAt: AT,
    })

    expect(selection.isEmpty()).toBe(false)
    expect(selection.epicItemId).toBe('golpe-de-defensa')
    expect(selection.epicProductId).toBe('pid-golpe-de-defensa')

    const [event] = selection.pullEvents()
    expect(event).toMatchObject({
      name: 'hero.epic.equipped',
      aggregateId: 'jugador-1:heroe-1',
      heroId: 'heroe-1',
      epicItemId: 'golpe-de-defensa',
      epicProductId: 'pid-golpe-de-defensa',
    })
    // pullEvents drena: una segunda llamada no repite el evento.
    expect(selection.pullEvents()).toEqual([])
  })

  it('equip() reemplaza directamente una seleccion anterior (sin unequip)', () => {
    const selection = HeroEpicSelection.createEmpty('jugador-1', 'heroe-1')
    selection.equip({ epicItemId: 'golpe-de-defensa', epicProductId: 'pid-a', occurredAt: AT })
    selection.equip({ epicItemId: 'segundo-impulso', epicProductId: 'pid-b', occurredAt: AT })

    expect(selection.epicItemId).toBe('segundo-impulso')
    expect(selection.epicProductId).toBe('pid-b')
  })

  it('toSnapshot/restore son inversas', () => {
    const selection = HeroEpicSelection.createEmpty('jugador-1', 'heroe-1')
    selection.equip({ epicItemId: 'golpe-de-defensa', epicProductId: 'pid-a', occurredAt: AT })

    const restored = HeroEpicSelection.restore({ ...selection.toSnapshot(), version: 1 })
    expect(restored.epicItemId).toBe('golpe-de-defensa')
    expect(restored.epicProductId).toBe('pid-a')
    expect(restored.version).toBe(1)
  })

  it('restore rechaza una version que no es un entero no negativo', () => {
    const base = HeroEpicSelection.createEmpty('jugador-1', 'heroe-1').toSnapshot()

    expect(() => HeroEpicSelection.restore({ ...base, version: -1 })).toThrow(DomainError)
    expect(() => HeroEpicSelection.restore({ ...base, version: 1.5 })).toThrow(DomainError)
  })

  it('restore rechaza una pareja incompleta de referencias', () => {
    const base = HeroEpicSelection.createEmpty('jugador-1', 'heroe-1').toSnapshot()

    expect(() =>
      HeroEpicSelection.restore({ ...base, epicItemId: 'golpe-de-defensa', epicProductId: null }),
    ).toThrow(/ambas referencias o ninguna/)
    expect(() =>
      HeroEpicSelection.restore({ ...base, epicItemId: null, epicProductId: 'pid-a' }),
    ).toThrow(/ambas referencias o ninguna/)
  })
})
