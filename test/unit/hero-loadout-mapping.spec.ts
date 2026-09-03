import { Int32 } from 'mongodb'

import {
  HeroLoadoutMappingError,
  documentId,
  toDocument,
  toSnapshot,
  type HeroLoadoutDocument,
} from '../../src/adapters/outbound/persistence/hero-loadout-mapping'
import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'

const baseDoc = (overrides: Partial<HeroLoadoutDocument> = {}): HeroLoadoutDocument => ({
  _id: documentId('jugador-1', 'heroe-1'),
  ownerId: 'jugador-1',
  heroId: 'heroe-1',
  version: new Int32(2),
  entries: [{ slot: 'WEAPON_1', itemId: 'espada-de-fuego', productId: 'pid-espada' }],
  ...overrides,
})

describe('hero-loadout-mapping', () => {
  it('documentId compone (jugador, heroe) de forma estable', () => {
    expect(documentId('a', 'b')).toBe('a::b')
  })

  it('toSnapshot y toDocument son inversas para un loadout valido', () => {
    const snapshot = toSnapshot(baseDoc())
    expect(snapshot).toEqual({
      ownerId: 'jugador-1',
      heroId: 'heroe-1',
      version: 2,
      entries: [{ slot: 'WEAPON_1', itemId: 'espada-de-fuego', productId: 'pid-espada' }],
    })

    const roundTripped = toDocument(snapshot)
    expect(roundTripped._id).toBe(snapshot.ownerId + '::' + snapshot.heroId)
    expect(roundTripped.version).toBeInstanceOf(Int32)
    expect(toSnapshot(roundTripped)).toEqual(snapshot)
  })

  it('acepta la version como numero suelto o como Int32', () => {
    expect(toSnapshot(baseDoc({ version: 3 })).version).toBe(3)
    expect(toSnapshot(baseDoc({ version: new Int32(4) })).version).toBe(4)
  })

  it('rechaza una version que no es un entero no negativo', () => {
    expect(() => toSnapshot(baseDoc({ version: -1 }))).toThrow(HeroLoadoutMappingError)
    expect(() => toSnapshot(baseDoc({ version: 1.5 }))).toThrow(HeroLoadoutMappingError)
  })

  it('rechaza una ranura desconocida, una ranura repetida y un objeto repetido', () => {
    expect(() =>
      toSnapshot(baseDoc({ entries: [{ slot: 'ANILLO', itemId: 'anillo', productId: 'p' }] })),
    ).toThrow(/ranura desconocida/)

    expect(() =>
      toSnapshot(
        baseDoc({
          entries: [
            { slot: 'WEAPON_1', itemId: 'espada', productId: 'p1' },
            { slot: 'WEAPON_1', itemId: 'hacha', productId: 'p2' },
          ],
        }),
      ),
    ).toThrow(/repite la ranura/)

    expect(() =>
      toSnapshot(
        baseDoc({
          entries: [
            { slot: 'WEAPON_1', itemId: 'espada', productId: 'p1' },
            { slot: 'WEAPON_2', itemId: 'espada', productId: 'p2' },
          ],
        }),
      ),
    ).toThrow(/repite el objeto/)
  })

  it('un loadout de dominio se traduce a documento y vuelve intacto', () => {
    const loadout = HeroLoadout.createEmpty('jugador-9', 'heroe-9')
    loadout.equip({
      slot: 'HELMET',
      itemId: 'casco-de-acero',
      productId: 'pid-casco',
      category: 'ARMOR',
      occurredAt: new Date('2026-09-03T00:00:00.000Z'),
    })

    const document = toDocument(loadout.toSnapshot())
    const restored = HeroLoadout.restore(toSnapshot(document))

    expect(restored.entry('HELMET')?.itemId).toBe('casco-de-acero')
  })
})
