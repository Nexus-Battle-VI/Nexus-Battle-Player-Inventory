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
  fingerprintOf,
  toReplayResult,
  type ExperienceGrantDocument,
} from './experience-grant-mapping'

/**
 * Acreditacion idempotente de experiencia en memoria (HU-09, Task HU-09.3).
 *
 * Doble de pruebas y de `PERSISTENCE_DRIVER=memory`, con la MISMA semantica que
 * `MongoExperienceGrantRepository`: mismo `operationId` con el mismo contenido
 * devuelve lo guardado con `applied: false`; con otro contenido, conflicto. Eso
 * es lo que permiten comprobar las pruebas sin contenedor, y por eso la
 * comprobacion de la huella esta aqui igual que alli.
 *
 * SIN `await` ENTRE COMPROBAR Y ESCRIBIR: todo el cuerpo corre en un solo turno
 * de JavaScript, asi que no hay ventana en la que otra acreditacion se cuele.
 * Es el mismo recurso que usa `InMemoryInventoryRepository`.
 *
 * Guarda instantaneas, no objetos vivos: lo que se lee es lo que se escribio.
 */
export class InMemoryExperienceGrantRepository implements ExperienceGrantPort {
  private readonly progressions = new Map<string, ReturnType<HeroProgression['toSnapshot']>>()
  private readonly ledger = new Map<string, ExperienceGrantDocument>()

  grant(command: ExperienceGrantCommand): Promise<ExperienceGrantResult> {
    try {
      const fingerprint = fingerprintOf(command)
      const previous = this.ledger.get(command.operationId)

      if (previous !== undefined) {
        if (previous.fingerprint !== fingerprint) {
          throw new ExperienceGrantConflictError(command.operationId)
        }

        return Promise.resolve(replayOf(previous, command.operationId))
      }

      const key = `${command.ownerId}::${command.heroId}`
      const stored = this.progressions.get(key)
      const before = progressionOf(stored, command)
      const after = awarded(before, command)

      const result: ExperienceGrantResult = {
        operationId: command.operationId,
        applied: true,
        heroId: command.heroId,
        level: after.level.value,
        currentXp: after.experience.currentXp,
        leveledUp: after.level.value > before.level.value,
        levelsGained: after.level.value - before.level.value,
      }

      this.progressions.set(key, { ...after.toSnapshot(), version: before.version + 1 })
      this.ledger.set(command.operationId, {
        _id: command.operationId,
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
        result: { ...result },
        createdAt: new Date(),
      })

      return Promise.resolve(result)
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

/**
 * El resultado guardado. El `_id` del asiento es la propia clave del mapa, asi
 * que el documento que se reconstruye aqui lleva el `operationId` que se pidio.
 */
const replayOf = (document: ExperienceGrantDocument, operationId: string): ExperienceGrantResult =>
  toReplayResult({ ...document, _id: operationId }, operationId)

/** Progresion del heroe, con creacion perezosa (nivel 1 con 0). */
const progressionOf = (
  stored: ReturnType<HeroProgression['toSnapshot']> | undefined,
  command: ExperienceGrantCommand,
): HeroProgression => {
  try {
    return stored === undefined
      ? HeroProgression.createEmpty(command.ownerId, command.heroId)
      : HeroProgression.restore(stored)
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      throw new ExperienceGrantRejectedError(
        `El heroe ${command.heroId} no es acreditable: su progresion no se puede leer. ${error.message}`,
      )
    }

    throw error
  }
}

/**
 * Acredita con la aritmetica de HU-08.
 *
 * Un conflicto de version no puede ocurrir aqui --no hay `await` en medio-- pero
 * el tipo lo deja dicho: si algun dia se introduce uno, la segunda acreditacion
 * tiene que fallar con `HeroProgressionConflictError` igual que en Mongo.
 */
const awarded = (
  progression: HeroProgression,
  command: ExperienceGrantCommand,
): HeroProgression => {
  try {
    return progression.awardExperience(command.amount)
  } catch (error: unknown) {
    if (error instanceof HeroProgressionConflictError) throw error

    if (error instanceof DomainError) {
      throw new ExperienceGrantRejectedError(
        `El heroe ${command.heroId} no es acreditable: ${error.message}`,
      )
    }

    throw error
  }
}
