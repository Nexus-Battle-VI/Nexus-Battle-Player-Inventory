import { Int32 } from 'mongodb'

import {
  HeroEpicSelectionMappingError,
  documentId,
  toDocument,
  toSnapshot,
  type HeroEpicSelectionDocument,
} from '../../src/adapters/outbound/persistence/hero-epic-selection-mapping'
import { HeroEpicSelection } from '../../src/domain/entities/HeroEpicSelection'

const baseDoc = (
  overrides: Partial<HeroEpicSelectionDocument> = {},
): HeroEpicSelectionDocument => ({
  _id: documentId('jugador-1', 'heroe-1'),
  ownerId: 'jugador-1',
  heroId: 'heroe-1',
  version: new Int32(2),
  epicItemId: 'golpe-de-defensa',
  epicProductId: 'pid-golpe-de-defensa',
  ...overrides,
})

describe('hero-epic-selection-mapping', () => {
  it('documentId compone (jugador, heroe) de forma estable', () => {
    expect(documentId('a', 'b')).toBe('a::b')
  })

  it('toSnapshot y toDocument son inversas para una seleccion con epica', () => {
    const snapshot = toSnapshot(baseDoc())
    expect(snapshot).toEqual({
      ownerId: 'jugador-1',
      heroId: 'heroe-1',
      version: 2,
      epicItemId: 'golpe-de-defensa',
      epicProductId: 'pid-golpe-de-defensa',
    })

    const roundTripped = toDocument(snapshot)
    expect(roundTripped._id).toBe(snapshot.ownerId + '::' + snapshot.heroId)
    expect(roundTripped.version).toBeInstanceOf(Int32)
    expect(toSnapshot(roundTripped)).toEqual(snapshot)
  })

  it('toSnapshot y toDocument son inversas para una seleccion vacia (ambas referencias null)', () => {
    const snapshot = toSnapshot(baseDoc({ epicItemId: null, epicProductId: null }))
    expect(snapshot.epicItemId).toBeNull()
    expect(snapshot.epicProductId).toBeNull()

    const roundTripped = toDocument(snapshot)
    expect(toSnapshot(roundTripped)).toEqual(snapshot)
  })

  it('acepta la version como numero suelto o como Int32', () => {
    expect(toSnapshot(baseDoc({ version: 3 })).version).toBe(3)
    expect(toSnapshot(baseDoc({ version: new Int32(4) })).version).toBe(4)
  })

  it('rechaza una version que no es un entero no negativo', () => {
    expect(() => toSnapshot(baseDoc({ version: -1 }))).toThrow(HeroEpicSelectionMappingError)
    expect(() => toSnapshot(baseDoc({ version: 1.5 }))).toThrow(HeroEpicSelectionMappingError)
  })

  it('rechaza un documento que declara una sola referencia de la pareja', () => {
    expect(() => toSnapshot(baseDoc({ epicItemId: null }))).toThrow(/declara una sola referencia/)
    expect(() => toSnapshot(baseDoc({ epicProductId: null }))).toThrow(
      /declara una sola referencia/,
    )
  })

  it('una seleccion de dominio se traduce a documento y vuelve intacta', () => {
    const selection = HeroEpicSelection.createEmpty('jugador-9', 'heroe-9')
    selection.equip({
      epicItemId: 'golpe-de-defensa',
      epicProductId: 'pid-golpe-de-defensa',
      occurredAt: new Date('2026-10-03T00:00:00.000Z'),
    })

    const document = toDocument(selection.toSnapshot())
    const restored = HeroEpicSelection.restore(toSnapshot(document))

    expect(restored.epicItemId).toBe('golpe-de-defensa')
    expect(restored.epicProductId).toBe('pid-golpe-de-defensa')
  })
})
