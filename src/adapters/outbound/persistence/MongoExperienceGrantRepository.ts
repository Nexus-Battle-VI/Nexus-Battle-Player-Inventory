import { Int32, MongoServerError, type ClientSession, type Collection, type Db } from 'mongodb'

import { HeroProgression } from '../../../domain/entities/HeroProgression'
import { DomainError } from '../../../domain/errors/DomainError'
import {
  ExperienceGrantConflictError,
  ExperienceGrantRejectedError,
  HeroProgressionConflictError,
} from '../../../application/errors/ApplicationError'
import type {
  ExperienceGrantCommand,
  ExperienceGrantPort,
  ExperienceGrantResult,
} from '../../../application/ports/ExperienceGrantPort'
import {
  HeroProgressionMappingError,
  toDocument as toProgressionDocument,
  toSnapshot as toProgressionSnapshot,
  documentId as heroProgressionDocumentId,
  type HeroProgressionDocument,
} from './hero-progression-mapping'
import {
  ExperienceGrantMappingError,
  fingerprintOf,
  documentId as grantDocumentId,
  toReplayResult,
  toResultDocument,
  type ExperienceGrantDocument,
} from './experience-grant-mapping'

export const EXPERIENCE_GRANTS_COLLECTION = 'experience_grants'

/** Coleccion de HU-08 (migracion `008-hero-progressions`). */
const HERO_PROGRESSIONS_COLLECTION = 'hero-progressions'

/**
 * Acreditacion idempotente de experiencia sobre MongoDB (HU-09, Task HU-09.3;
 * `hu-09-experience-reward-v1` §7).
 *
 * LEDGER Y PROGRESION EN LA MISMA TRANSACCION, que es lo que impide los dos
 * estados a medias: no puede quedar un asiento de ledger sin experiencia
 * acreditada (una recompensa perdida que un reintento daria por hecha) ni una
 * experiencia sin asiento (que un reintento volveria a sumar). El patron es el
 * de `MongoInventoryRepository.grant`: `withSession` + `session.withTransaction`,
 * huella del contenido para distinguir el reintento del conflicto, y relectura
 * del asiento cuando otro proceso gano la carrera.
 *
 * LA IDEMPOTENCIA NO ES "NO ESCRIBIR DOS VECES". Es "el mismo `operationId` con
 * el mismo contenido produce el mismo resultado y no vuelve a acreditar". Por eso
 * un replay devuelve el asiento guardado con `applied: false`, y por eso el
 * mismo `operationId` con otro contenido es `409` en lugar de sobrescribir.
 *
 * EL BLOQUEO OPTIMISTA DE LA PROGRESION SE CONSERVA. La escritura sigue
 * condicionada por la version, como en `MongoHeroProgressionRepository`: dos
 * ACREDITACIONES DISTINTAS (dos derrotas del mismo heroe resueltas a la vez)
 * compiten por la misma version y la segunda se reintenta, en lugar de sumar
 * sobre un valor ya superado.
 *
 * NO CALCULA NIVELES. `HeroProgression.awardExperience` (HU-08) suma y
 * recalcula; aqui solo se lee el resultado. El umbral no se toca ni se guarda.
 */
export class MongoExperienceGrantRepository implements ExperienceGrantPort {
  private readonly ledger: Collection<ExperienceGrantDocument>
  private readonly progressions: Collection<HeroProgressionDocument>

  constructor(private readonly db: Db) {
    this.ledger = db.collection<ExperienceGrantDocument>(EXPERIENCE_GRANTS_COLLECTION)
    this.progressions = db.collection<HeroProgressionDocument>(HERO_PROGRESSIONS_COLLECTION)
  }

  async grant(command: ExperienceGrantCommand): Promise<ExperienceGrantResult> {
    const fingerprint = fingerprintOf(command)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.client.withSession(async (session) =>
          session.withTransaction(
            async () => {
              const previous = await this.ledger.findOne(
                { _id: grantDocumentId(command.operationId) },
                { session },
              )

              if (previous !== null) {
                if (previous.fingerprint !== fingerprint) {
                  throw new ExperienceGrantConflictError(command.operationId)
                }

                // Replay: se devuelve lo que YA se acredito, sin volver a sumar.
                return replayResult(previous, command.operationId)
              }

              const document = await this.progressions.findOne(
                { _id: heroProgressionDocumentId(command.ownerId, command.heroId) },
                { session },
              )
              const before = progressionOf(document, command)
              const after = awarded(before, command)

              const nextDocument: HeroProgressionDocument = {
                ...toProgressionDocument(after.toSnapshot()),
                version: new Int32(before.version + 1),
              }

              await this.persist(document === null, nextDocument, before.version, command, session)

              const result: ExperienceGrantResult = {
                operationId: command.operationId,
                applied: true,
                heroId: command.heroId,
                level: after.level.value,
                currentXp: after.experience.currentXp,
                leveledUp: after.level.value > before.level.value,
                levelsGained: after.level.value - before.level.value,
              }

              await this.ledger.insertOne(
                {
                  _id: grantDocumentId(command.operationId),
                  fingerprint,
                  ownerId: command.ownerId,
                  heroId: command.heroId,
                  amount: command.amount,
                  roll: command.source.roll,
                  enrollmentId: command.source.enrollmentId,
                  simulationId: command.source.simulationId,
                  encounterId: command.source.encounterId,
                  enemyInstanceId: command.source.enemyInstanceId,
                  rivalRef: command.source.rivalRef,
                  result: toResultDocument(result),
                  createdAt: new Date(),
                },
                { session },
              )

              return result
            },
            { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
          ),
        )
      } catch (error: unknown) {
        // Dos acreditaciones simultaneas del MISMO heroe pueden chocar al crear
        // su progresion antes de que el motor lo clasifique como WriteConflict.
        // Volver a leer es seguro: la transaccion se rehace desde el principio y
        // el ledger decide si esto era un reintento.
        if (!(error instanceof MongoServerError && error.code === 11000) || attempt === 2) {
          throw error
        }
      }
    }

    throw new HeroProgressionConflictError(command.heroId)
  }

  /**
   * Escritura de la progresion con bloqueo optimista, DENTRO de la transaccion
   * del llamante: la `session` viaja hasta aqui porque es lo que hace que la
   * progresion y el asiento del ledger sean una sola operacion.
   *
   * `insertOne` cuando el heroe no tenia documento (creacion perezosa: nivel 1
   * con 0, que es `HeroProgression.createEmpty`) y `replaceOne` condicionado por
   * la version cuando ya lo tenia.
   */
  private async persist(
    isNew: boolean,
    nextDocument: HeroProgressionDocument,
    expectedVersion: number,
    command: ExperienceGrantCommand,
    session: ClientSession,
  ): Promise<void> {
    if (isNew) {
      try {
        await this.progressions.insertOne(nextDocument, { session })
      } catch (error: unknown) {
        if (error instanceof MongoServerError && error.code === 11000) {
          throw new HeroProgressionConflictError(command.heroId)
        }

        throw error
      }

      return
    }

    const saved = await this.progressions.replaceOne(
      { _id: nextDocument._id, version: new Int32(expectedVersion) },
      nextDocument,
      { session },
    )

    if (saved.matchedCount !== 1) {
      throw new HeroProgressionConflictError(command.heroId)
    }
  }
}

/** El resultado guardado, o un error si el asiento esta incompleto. */
const replayResult = (
  document: ExperienceGrantDocument,
  operationId: string,
): ExperienceGrantResult => {
  try {
    return toReplayResult(document, operationId)
  } catch (error: unknown) {
    if (error instanceof ExperienceGrantMappingError) {
      throw new ExperienceGrantRejectedError(
        `El heroe no es acreditable: el asiento ${operationId} esta incompleto. ${error.message}`,
      )
    }

    throw error
  }
}

/**
 * Progresion del heroe, con creacion perezosa.
 *
 * Un documento ilegible --nivel fuera de rango, nivel que no corresponde a su
 * acumulado-- NO se acepta ni se repara: el heroe no es acreditable y se dice,
 * que es el `422` del contrato. Repararlo en silencio inventaria un estado que
 * nadie aprobo.
 */
const progressionOf = (
  document: HeroProgressionDocument | null,
  command: ExperienceGrantCommand,
): HeroProgression => {
  try {
    return document === null
      ? HeroProgression.createEmpty(command.ownerId, command.heroId)
      : HeroProgression.restore(toProgressionSnapshot(document))
  } catch (error: unknown) {
    if (error instanceof HeroProgressionMappingError || error instanceof DomainError) {
      throw new ExperienceGrantRejectedError(
        `El heroe ${command.heroId} no es acreditable: su progresion no se puede leer. ${error.message}`,
      )
    }

    throw error
  }
}

/** Acredita con la aritmetica de HU-08. No se recalcula ningun nivel aqui. */
const awarded = (
  progression: HeroProgression,
  command: ExperienceGrantCommand,
): HeroProgression => {
  try {
    return progression.awardExperience(command.amount)
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      throw new ExperienceGrantRejectedError(
        `El heroe ${command.heroId} no es acreditable: ${error.message}`,
      )
    }

    throw error
  }
}
