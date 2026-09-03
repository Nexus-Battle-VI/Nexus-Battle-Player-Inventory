import { Int32, MongoServerError, type Collection, type Db } from 'mongodb'

import { HeroLoadout } from '../../../domain/entities/HeroLoadout'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroLoadoutConflictError } from '../../../application/errors/ApplicationError'
import type { HeroLoadoutRepositoryPort } from '../../../application/ports/HeroLoadoutRepositoryPort'
import {
  documentId,
  toDocument,
  toSnapshot,
  type HeroLoadoutDocument,
} from './hero-loadout-mapping'

/**
 * Repositorio del loadout de heroe sobre MongoDB (RF-28, §12 atomicidad).
 *
 * La escritura es una sola operacion condicionada por la version: la condicion
 * viaja DENTRO del `replaceOne`, asi que dos peticiones simultaneas por el mismo
 * heroe no pueden romper el limite 2/6/2 —la segunda no encuentra documento con
 * la version esperada y se traduce a 409—. No hace falta transaccion: el
 * loadout, con sus entradas embebidas, es un solo documento y su escritura ya
 * es atomica en el motor.
 */
export class MongoHeroLoadoutRepository implements HeroLoadoutRepositoryPort {
  private readonly loadouts: Collection<HeroLoadoutDocument>

  constructor(db: Db) {
    this.loadouts = db.collection<HeroLoadoutDocument>('hero-loadouts')
  }

  async findByHero(ownerId: PlayerId, heroId: string): Promise<HeroLoadout | null> {
    const document = await this.loadouts.findOne({ _id: documentId(ownerId.value, heroId) })

    return document === null ? null : HeroLoadout.restore(toSnapshot(document))
  }

  async save(loadout: HeroLoadout, expectedVersion: number): Promise<HeroLoadout> {
    const snapshot = loadout.toSnapshot()
    const nextDocument: HeroLoadoutDocument = {
      ...toDocument(snapshot),
      version: new Int32(expectedVersion + 1),
    }

    if (expectedVersion === 0) {
      try {
        await this.loadouts.insertOne(nextDocument)
      } catch (error: unknown) {
        // Otra peticion creo el loadout primero: es un conflicto de version, no
        // un fallo del servicio.
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new HeroLoadoutConflictError(loadout.heroId)
        }
        throw error
      }
    } else {
      const result = await this.loadouts.replaceOne(
        { _id: nextDocument._id, version: new Int32(expectedVersion) },
        nextDocument,
      )

      if (result.matchedCount === 0) {
        throw new HeroLoadoutConflictError(loadout.heroId)
      }
    }

    loadout.pullEvents()

    return HeroLoadout.restore(toSnapshot(nextDocument))
  }
}
