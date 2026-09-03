import { Int32, MongoServerError, type Collection, type Db } from 'mongodb'

import { HeroSelection } from '../../../domain/entities/HeroSelection'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroSelectionConflictError } from '../../../application/errors/ApplicationError'
import type { HeroSelectionRepositoryPort } from '../../../application/ports/HeroSelectionRepositoryPort'
import { toDocument, toSnapshot, type HeroSelectionDocument } from './hero-selection-mapping'

/**
 * Seleccion de heroe sobre MongoDB (HU-07).
 *
 * La condicion de version viaja DENTRO del `replaceOne`, igual que en el
 * loadout: dos peticiones simultaneas del mismo jugador no pueden dejar dos
 * heroes preparados, porque la segunda no encuentra documento con la version
 * esperada y se traduce a 409. No hace falta transaccion: es un solo documento.
 */
export class MongoHeroSelectionRepository implements HeroSelectionRepositoryPort {
  private readonly selections: Collection<HeroSelectionDocument>

  constructor(db: Db) {
    this.selections = db.collection<HeroSelectionDocument>('hero-selections')
  }

  async findByOwner(ownerId: PlayerId): Promise<HeroSelection | null> {
    const document = await this.selections.findOne({ _id: ownerId.value })

    return document === null ? null : HeroSelection.restore(toSnapshot(document))
  }

  async save(selection: HeroSelection, expectedVersion: number): Promise<HeroSelection> {
    const next: HeroSelectionDocument = {
      ...toDocument(selection.toSnapshot()),
      version: new Int32(expectedVersion + 1),
    }

    if (expectedVersion === 0) {
      try {
        await this.selections.insertOne(next)
      } catch (error: unknown) {
        // Otra peticion creo la seleccion primero: es un conflicto de version,
        // no un fallo del servicio.
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new HeroSelectionConflictError(selection.ownerId)
        }
        throw error
      }
    } else {
      const result = await this.selections.replaceOne(
        { _id: next._id, version: new Int32(expectedVersion) },
        next,
      )

      if (result.matchedCount === 0) {
        throw new HeroSelectionConflictError(selection.ownerId)
      }
    }

    return HeroSelection.restore(toSnapshot(next))
  }
}
