import { Int32 } from 'mongodb'

import type { HeroEpicSelectionSnapshot } from '../../../domain/entities/HeroEpicSelection'

/**
 * Traduccion entre el documento de MongoDB y la instantanea de la epica
 * equipada (HU-31). Pura y aparte del repositorio, mismo patron que
 * `hero-loadout-mapping.ts`.
 */

export class HeroEpicSelectionMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeroEpicSelectionMappingError'
  }
}

/**
 * `_id` compuesto por (jugador, heroe): un heroe de un jugador tiene como
 * maximo UNA epica equipada, y MongoDB garantiza esa unicidad sin indice
 * adicional. `version` habilita el bloqueo optimista.
 */
export interface HeroEpicSelectionDocument {
  readonly _id: string
  readonly ownerId: string
  readonly heroId: string
  readonly version: Int32 | number
  readonly epicItemId: string | null
  readonly epicProductId: string | null
}

export const documentId = (ownerId: string, heroId: string): string => `${ownerId}::${heroId}`

const toInteger = (raw: Int32 | number, context: string): number => {
  const value = typeof raw === 'number' ? raw : raw.valueOf()

  if (!Number.isInteger(value) || value < 0) {
    throw new HeroEpicSelectionMappingError(
      `${context} no es un entero no negativo: ${String(value)}.`,
    )
  }

  return value
}

export const toSnapshot = (document: HeroEpicSelectionDocument): HeroEpicSelectionSnapshot => {
  if ((document.epicItemId === null) !== (document.epicProductId === null)) {
    throw new HeroEpicSelectionMappingError(
      `La epica equipada ${document._id} declara una sola referencia de la pareja.`,
    )
  }

  return {
    ownerId: document.ownerId,
    heroId: document.heroId,
    version: toInteger(document.version, `La version de la epica equipada ${document._id}`),
    epicItemId: document.epicItemId,
    epicProductId: document.epicProductId,
  }
}

export const toDocument = (snapshot: HeroEpicSelectionSnapshot): HeroEpicSelectionDocument => ({
  _id: documentId(snapshot.ownerId, snapshot.heroId),
  ownerId: snapshot.ownerId,
  heroId: snapshot.heroId,
  version: new Int32(snapshot.version),
  epicItemId: snapshot.epicItemId,
  epicProductId: snapshot.epicProductId,
})
