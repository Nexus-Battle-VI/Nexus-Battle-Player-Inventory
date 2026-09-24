import { Int32 } from 'mongodb'

import {
  HeroProgressionMappingError,
  documentId,
  toDocument,
  toSnapshot,
  type HeroProgressionDocument,
} from '../../src/adapters/outbound/persistence/hero-progression-mapping'

/**
 * Traduccion documento <-> instantanea (HU-08, Task #189).
 *
 * El caso que de verdad importa aqui es el DOCUMENTO CORRUPTO: un nivel fuera de
 * rango o una version promocionada a decimal no deben llegar al dominio
 * disfrazados de dato bueno.
 */
describe('hero-progression-mapping', () => {
  const snapshot = {
    ownerId: 'jugador-1',
    heroId: 'heroe-1',
    level: 4,
    currentXp: 890,
    version: 2,
  }

  const document: HeroProgressionDocument = {
    _id: documentId('jugador-1', 'heroe-1'),
    ownerId: 'jugador-1',
    heroId: 'heroe-1',
    level: new Int32(4),
    currentXp: new Int32(890),
    version: new Int32(2),
  }

  it('compone la clave con el mismo separador que el loadout de heroe', () => {
    expect(documentId('jugador-1', 'heroe-1')).toBe('jugador-1::heroe-1')
  })

  it('desempaqueta los Int32 del driver', () => {
    expect(toSnapshot(document)).toEqual(snapshot)
  })

  it('acepta numeros planos, que es lo que produce el adaptador en memoria', () => {
    expect(toSnapshot({ ...document, level: 4, currentXp: 890, version: 2 })).toEqual(snapshot)
  })

  it('escribe `int` y no `double`: el validador lo exige', () => {
    const written = toDocument(snapshot)

    expect(written.level).toBeInstanceOf(Int32)
    expect(written.currentXp).toBeInstanceOf(Int32)
    expect(written.version).toBeInstanceOf(Int32)
  })

  it('ida y vuelta: documento -> instantanea -> documento es estable', () => {
    expect(toDocument(toSnapshot(document))).toEqual(document)
  })

  describe('documentos corruptos', () => {
    it('rechaza un nivel fuera del rango 1..8', () => {
      expect(() => toSnapshot({ ...document, level: new Int32(0) })).toThrow(
        HeroProgressionMappingError,
      )
      expect(() => toSnapshot({ ...document, level: new Int32(9) })).toThrow(
        HeroProgressionMappingError,
      )
    })

    it('rechaza una experiencia negativa', () => {
      expect(() => toSnapshot({ ...document, currentXp: new Int32(-1) })).toThrow(
        HeroProgressionMappingError,
      )
    })

    it('rechaza una version negativa', () => {
      expect(() => toSnapshot({ ...document, version: new Int32(-1) })).toThrow(
        HeroProgressionMappingError,
      )
    })

    it('rechaza un valor promocionado con decimales', () => {
      // Un `double` con decimales es un documento que el validador de
      // `008-hero-progressions` no deberia haber dejado entrar.
      expect(() => toSnapshot({ ...document, level: 4.5 })).toThrow(HeroProgressionMappingError)
      expect(() => toSnapshot({ ...document, version: 1.5 })).toThrow(HeroProgressionMappingError)
    })

    it('dice cual es el documento y el campo, para poder diagnosticarlo', () => {
      expect(() => toSnapshot({ ...document, level: new Int32(9) })).toThrow(/jugador-1::heroe-1/)
    })
  })
})
