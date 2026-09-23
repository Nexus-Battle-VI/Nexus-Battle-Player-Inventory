import { Int32 } from 'mongodb'

import { MAX_HERO_LEVEL, MIN_HERO_LEVEL } from '../../../domain/value-objects/hero-level'
import type { HeroProgressionSnapshot } from '../../../domain/entities/HeroProgression'

/**
 * Traduccion entre el documento de MongoDB y la instantanea de la progresion.
 *
 * Pura y aparte del repositorio, como `hero-loadout-mapping`: es donde se puede
 * uno equivocar de verdad —un `Int32` que no se desempaqueta, un nivel que se
 * cuela fuera de rango— y sacarla permite probarla sin contenedor.
 *
 * VALIDA AL LEER, NO SOLO AL ESCRIBIR. Un documento corrupto (nivel 0, nivel 9,
 * version negativa) no debe llegar al dominio disfrazado de dato bueno: se
 * detecta aqui y se dice cual. `HeroProgression.restore` volveria a validarlo,
 * pero entonces el error hablaria de dominio cuando el problema es de datos.
 */

export class HeroProgressionMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeroProgressionMappingError'
  }
}

export interface HeroProgressionDocument {
  readonly _id: string
  readonly ownerId: string
  readonly heroId: string
  readonly level: Int32 | number
  readonly currentXp: Int32 | number
  readonly version: Int32 | number
}

/**
 * `_id` compuesto por (jugador, heroe) con el MISMO separador que el loadout de
 * heroe (`::`). Un heroe de un jugador tiene exactamente una progresion, y
 * MongoDB garantiza esa unicidad sin indice adicional.
 */
export const documentId = (ownerId: string, heroId: string): string => `${ownerId}::${heroId}`

/**
 * Desempaqueta un entero de MongoDB y comprueba su rango.
 *
 * El driver devuelve `Int32` para los campos declarados `int` en el validador,
 * y `number` cuando el documento se construyo en memoria. Ambos casos se
 * aceptan, pero un valor promocionado a `double` con decimales NO: seria un
 * documento que el validador no deberia haber dejado entrar.
 */
const toInteger = (
  raw: Int32 | number,
  context: string,
  bounds: { readonly min: number; readonly max?: number },
): number => {
  const value = typeof raw === 'number' ? raw : raw.valueOf()

  if (
    !Number.isInteger(value) ||
    value < bounds.min ||
    (bounds.max !== undefined && value > bounds.max)
  ) {
    const range =
      bounds.max === undefined
        ? `mayor o igual que ${String(bounds.min)}`
        : `entre ${String(bounds.min)} y ${String(bounds.max)}`
    throw new HeroProgressionMappingError(
      `${context} debe ser un entero ${range}: ${String(value)}.`,
    )
  }

  return value
}

export const toSnapshot = (document: HeroProgressionDocument): HeroProgressionSnapshot => ({
  ownerId: document.ownerId,
  heroId: document.heroId,
  level: toInteger(document.level, `El nivel de la progresion ${document._id}`, {
    min: MIN_HERO_LEVEL,
    max: MAX_HERO_LEVEL,
  }),
  currentXp: toInteger(document.currentXp, `La experiencia de la progresion ${document._id}`, {
    min: 0,
  }),
  version: toInteger(document.version, `La version de la progresion ${document._id}`, { min: 0 }),
})

export const toDocument = (snapshot: HeroProgressionSnapshot): HeroProgressionDocument => ({
  _id: documentId(snapshot.ownerId, snapshot.heroId),
  ownerId: snapshot.ownerId,
  heroId: snapshot.heroId,
  // `int` y no `double`: el validador de `008-hero-progressions` lo exige, y
  // dejar promocionar el tipo haria que dependiera del valor.
  level: new Int32(snapshot.level),
  currentXp: new Int32(snapshot.currentXp),
  version: new Int32(snapshot.version),
})
