import { Int32, MongoServerError, type Collection, type Db } from 'mongodb'

import { HeroEpicSelection } from '../../../domain/entities/HeroEpicSelection'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroEpicSelectionConflictError } from '../../../application/errors/ApplicationError'
import type { HeroEpicSelectionRepositoryPort } from '../../../application/ports/HeroEpicSelectionRepositoryPort'
import {
  documentId,
  toDocument,
  toSnapshot,
  type HeroEpicSelectionDocument,
} from './hero-epic-selection-mapping'

/**
 * Repositorio de la epica equipada sobre MongoDB (HU-31).
 *
 * Deliberadamente SIN la maquinaria de `MongoHeroLoadoutRepository`
 * (transacciones, `gates` de compromiso de mision): esta seleccion no tiene
 * capacidad 2/6/2 que proteger de una escritura concurrente de Missions, y
 * el contrato (`hu-31-equipped-epic-v1` §9) solo exige el bloqueo de batalla
 * de HU-29, que el caso de uso ya comprueba ANTES de llamar a `save`. Una
 * sola escritura con bloqueo optimista basta.
 */
export class MongoHeroEpicSelectionRepository implements HeroEpicSelectionRepositoryPort {
  private readonly selections: Collection<HeroEpicSelectionDocument>

  constructor(db: Db) {
    this.selections = db.collection<HeroEpicSelectionDocument>('hero-epic-selections')
  }

  async findByHero(ownerId: PlayerId, heroId: string): Promise<HeroEpicSelection | null> {
    const document = await this.selections.findOne({ _id: documentId(ownerId.value, heroId) })

    return document === null ? null : HeroEpicSelection.restore(toSnapshot(document))
  }

  async save(selection: HeroEpicSelection, expectedVersion: number): Promise<HeroEpicSelection> {
    const snapshot = selection.toSnapshot()
    const nextDocument: HeroEpicSelectionDocument = {
      ...toDocument(snapshot),
      version: new Int32(expectedVersion + 1),
    }

    try {
      if (expectedVersion === 0) {
        await this.selections.insertOne(nextDocument)
      } else {
        const result = await this.selections.replaceOne(
          { _id: nextDocument._id, version: new Int32(expectedVersion) },
          nextDocument,
        )
        if (result.matchedCount === 0) {
          throw new HeroEpicSelectionConflictError(selection.heroId)
        }
      }
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new HeroEpicSelectionConflictError(selection.heroId)
      }
      throw error
    }

    selection.pullEvents()

    return HeroEpicSelection.restore(toSnapshot(nextDocument))
  }
}
