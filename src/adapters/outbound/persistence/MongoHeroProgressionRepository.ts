import { Int32, MongoServerError, type Collection, type Db } from 'mongodb'

import { HeroProgression } from '../../../domain/entities/HeroProgression'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroProgressionConflictError } from '../../../application/errors/ApplicationError'
import type { HeroProgressionRepositoryPort } from '../../../application/ports/HeroProgressionRepositoryPort'
import {
  documentId,
  toDocument,
  toSnapshot,
  type HeroProgressionDocument,
} from './hero-progression-mapping'

/**
 * Repositorio de la progresion de un heroe sobre MongoDB (RF-08).
 *
 * Misma forma que `MongoHeroLoadoutRepository`, y por la misma razon: la
 * escritura es una sola operacion condicionada por la version. La condicion
 * viaja DENTRO del `replaceOne`, asi que dos recompensas simultaneas no pueden
 * acreditar experiencia dos veces —la segunda no encuentra documento con la
 * version esperada y se traduce a 409—. No hace falta transaccion: la progresion
 * es un solo documento y su escritura ya es atomica en el motor.
 *
 * EL UMBRAL NO SE ESCRIBE NUNCA. No hay campo, ni cache, ni proyeccion: se
 * calcula al leer. El validador `$jsonSchema` de `008-hero-progressions` lleva
 * `additionalProperties: false`, de modo que si alguien intentara anadir ese
 * campo el motor rechazaria la escritura.
 */
export class MongoHeroProgressionRepository implements HeroProgressionRepositoryPort {
  private readonly progressions: Collection<HeroProgressionDocument>

  constructor(db: Db) {
    this.progressions = db.collection<HeroProgressionDocument>('hero-progressions')
  }

  async findByHero(ownerId: PlayerId, heroId: string): Promise<HeroProgression | null> {
    const document = await this.progressions.findOne({ _id: documentId(ownerId.value, heroId) })

    return document === null ? null : HeroProgression.restore(toSnapshot(document))
  }

  async save(progression: HeroProgression, expectedVersion: number): Promise<HeroProgression> {
    const snapshot = progression.toSnapshot()
    const nextDocument: HeroProgressionDocument = {
      ...toDocument(snapshot),
      version: new Int32(expectedVersion + 1),
    }

    if (expectedVersion === 0) {
      try {
        await this.progressions.insertOne(nextDocument)
      } catch (error: unknown) {
        // Otra recompensa creo la progresion primero: es un conflicto de
        // version, no un fallo del servicio.
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new HeroProgressionConflictError(progression.heroId)
        }
        throw error
      }
    } else {
      const result = await this.progressions.replaceOne(
        { _id: nextDocument._id, version: new Int32(expectedVersion) },
        nextDocument,
      )

      if (result.matchedCount === 0) {
        throw new HeroProgressionConflictError(progression.heroId)
      }
    }

    return HeroProgression.restore(toSnapshot(nextDocument))
  }
}
