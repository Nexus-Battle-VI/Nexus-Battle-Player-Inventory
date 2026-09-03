import { Int32 } from 'mongodb'

import type { HeroSelectionSnapshot } from '../../../domain/entities/HeroSelection'

/**
 * Traduccion entre el documento de MongoDB y la instantanea de la seleccion
 * (HU-07). Pura y aparte del repositorio, igual que la del loadout: es donde se
 * puede uno equivocar de verdad y aqui se prueba sin contenedor.
 */
export class HeroSelectionMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeroSelectionMappingError'
  }
}

/**
 * `_id` es el jugador: una seleccion por jugador, y MongoDB garantiza esa
 * unicidad sin indice adicional. Elegir otro heroe SUSTITUYE este documento en
 * lugar de anadir uno, que es justo la invariante del agregado.
 */
export interface HeroSelectionDocument {
  readonly _id: string
  readonly heroId: string
  readonly selectedAt: Date
  readonly version: Int32 | number
}

export const toSnapshot = (document: HeroSelectionDocument): HeroSelectionSnapshot => {
  const rawVersion =
    typeof document.version === 'number' ? document.version : document.version.valueOf()

  if (!Number.isInteger(rawVersion) || rawVersion < 0) {
    throw new HeroSelectionMappingError(
      `La version de la seleccion de ${document._id} no es un entero no negativo: ${String(rawVersion)}.`,
    )
  }

  if (!(document.selectedAt instanceof Date) || Number.isNaN(document.selectedAt.getTime())) {
    throw new HeroSelectionMappingError(
      `La fecha de seleccion de ${document._id} no es una fecha valida.`,
    )
  }

  return {
    ownerId: document._id,
    heroId: document.heroId,
    selectedAt: document.selectedAt,
    version: rawVersion,
  }
}

export const toDocument = (snapshot: HeroSelectionSnapshot): HeroSelectionDocument => ({
  _id: snapshot.ownerId,
  heroId: snapshot.heroId,
  selectedAt: snapshot.selectedAt,
  version: new Int32(snapshot.version),
})
