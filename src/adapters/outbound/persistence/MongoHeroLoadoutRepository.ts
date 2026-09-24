import { randomUUID } from 'node:crypto'
import { Int32, MongoServerError, type ClientSession, type Collection, type Db } from 'mongodb'

import { HeroLoadout } from '../../../domain/entities/HeroLoadout'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { ItemId } from '../../../domain/value-objects/identifiers'
import { HeroLoadoutConflictError } from '../../../application/errors/ApplicationError'
import type { HeroLoadoutRepositoryPort } from '../../../application/ports/HeroLoadoutRepositoryPort'
import type {
  MissionHeroCommitment,
  MissionHeroCommitmentInput,
  MissionHeroCommitmentPort,
} from '../../../application/ports/MissionHeroCommitmentPort'
import {
  HeroCommittedError,
  MissionCommitmentConcurrentError,
  MissionCommitmentConflictError,
  sameMissionCommitment,
} from '../../../application/ports/MissionHeroCommitmentPort'
import {
  documentId,
  toDocument,
  toSnapshot,
  type HeroLoadoutDocument,
} from './hero-loadout-mapping'
import type { InventoryDocument } from './mapping'

/**
 * Repositorio del loadout de heroe sobre MongoDB (RF-28, §12 atomicidad).
 *
 * La version del loadout y el documento de exclusion de Missions se escriben
 * en una transaccion. La reserva toca el mismo documento de exclusion: una
 * escritura de equipo que corre a la vez pierde el bloqueo optimista o ve el
 * compromiso vigente. Asi no queda una ventana entre comprobar y guardar.
 */
interface HeroMissionGate {
  readonly _id: string
  readonly revision: Int32 | number
  readonly operationId: string | null
  readonly expiresAt: Date | null
}

interface MissionCommitmentDocument extends MissionHeroCommitment {
  readonly _id: string
}

const toCommitment = (document: MissionCommitmentDocument): MissionHeroCommitment => ({
  operationId: document.operationId,
  playerId: document.playerId,
  heroId: document.heroId,
  reference: document.reference,
  expiresAt: document.expiresAt,
  completeLoadout: document.completeLoadout,
  commitmentId: document.commitmentId,
  status: document.status,
})

export class MongoHeroLoadoutRepository
  implements HeroLoadoutRepositoryPort, MissionHeroCommitmentPort
{
  private readonly loadouts: Collection<HeroLoadoutDocument>
  private readonly gates: Collection<HeroMissionGate>
  private readonly commitments: Collection<MissionCommitmentDocument>

  constructor(private readonly db: Db) {
    this.loadouts = db.collection<HeroLoadoutDocument>('hero-loadouts')
    this.gates = db.collection<HeroMissionGate>('hero-mission-gates')
    this.commitments = db.collection<MissionCommitmentDocument>('mission-hero-commitments')
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

    try {
      await this.inTransaction(async (session) => {
        const gate = await this.gates.findOne({ _id: nextDocument._id }, { session })
        if (
          gate?.operationId !== null &&
          gate?.operationId !== undefined &&
          gate.expiresAt !== null &&
          gate.expiresAt > new Date()
        ) {
          throw new HeroCommittedError()
        }
        await this.writeGate(nextDocument._id, gate, null, null, session)

        if (expectedVersion === 0) {
          await this.loadouts.insertOne(nextDocument, { session })
        } else {
          const result = await this.loadouts.replaceOne(
            { _id: nextDocument._id, version: new Int32(expectedVersion) },
            nextDocument,
            { session },
          )
          if (result.matchedCount === 0) throw new HeroLoadoutConflictError(loadout.heroId)
        }
      })
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new HeroLoadoutConflictError(loadout.heroId)
      }
      throw error
    }

    loadout.pullEvents()

    return HeroLoadout.restore(toSnapshot(nextDocument))
  }

  async findByOperation(operationId: string): Promise<MissionHeroCommitment | null> {
    const document = await this.commitments.findOne({ _id: operationId })
    if (document === null) return null
    return toCommitment(document)
  }

  async commit(
    input: MissionHeroCommitmentInput,
    expectedLoadoutVersion: number,
  ): Promise<MissionHeroCommitment> {
    try {
      return await this.inTransaction(async (session) => {
        const previous = await this.commitments.findOne({ _id: input.operationId }, { session })
        if (previous !== null) return this.replay(previous, input)

        const key = documentId(input.playerId, input.heroId)
        const gate = await this.gates.findOne({ _id: key }, { session })
        if (
          gate?.operationId !== null &&
          gate?.operationId !== undefined &&
          gate.expiresAt !== null &&
          gate.expiresAt > new Date()
        ) {
          throw new HeroCommittedError()
        }
        const loadout = await this.loadouts.findOne({ _id: key }, { session })
        if (Number(loadout?.version ?? 0) !== expectedLoadoutVersion) {
          throw new MissionCommitmentConcurrentError()
        }

        // La comprobacion de propiedad del caso de uso sucede antes de esta
        // transaccion. Auction puede retirar el heroe o una pieza equipada
        // entre esa lectura y la reserva; se vuelve a verificar aqui, bajo
        // los mismos gates que toca Auction al retirar el producto.
        const inventory = await this.db
          .collection<InventoryDocument>('inventories')
          .findOne({ _id: input.playerId }, { session })
        const owned = new Set(
          inventory?.slots.filter((slot) => Number(slot.quantity) > 0).map((slot) => slot.itemId) ??
            [],
        )
        const required = [
          ItemId.create(input.heroId).value,
          ...(loadout?.entries.map((entry) => ItemId.create(entry.itemId).value) ?? []),
        ]
        if (required.some((itemId) => !owned.has(itemId))) {
          throw new MissionCommitmentConcurrentError()
        }

        await this.writeGate(key, gate, input.operationId, input.expiresAt, session)
        const commitment: MissionHeroCommitment = {
          ...input,
          commitmentId: randomUUID(),
          status: 'ACTIVE',
        }
        await this.commitments.insertOne({ ...commitment, _id: input.operationId }, { session })
        return commitment
      })
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        const previous = await this.commitments.findOne({ _id: input.operationId })
        if (previous !== null) return this.replay(previous, input)
        const active = await this.gates.findOne({ _id: documentId(input.playerId, input.heroId) })
        if (
          active?.operationId !== null &&
          active?.operationId !== undefined &&
          active.expiresAt !== null &&
          active.expiresAt > new Date()
        ) {
          throw new HeroCommittedError()
        }
        throw new MissionCommitmentConcurrentError()
      }
      throw error
    }
  }

  async release(operationId: string): Promise<void> {
    await this.inTransaction(async (session) => {
      const commitment = await this.commitments.findOne({ _id: operationId }, { session })
      if (commitment === null || commitment.status === 'RELEASED') return
      const key = documentId(commitment.playerId, commitment.heroId)
      const gate = await this.gates.findOne({ _id: key }, { session })
      if (gate?.operationId === operationId) {
        await this.writeGate(key, gate, null, null, session)
      }
      await this.commitments.updateOne(
        { _id: operationId },
        { $set: { status: 'RELEASED' } },
        { session },
      )
    })
  }

  private replay(
    previous: MissionCommitmentDocument,
    input: MissionHeroCommitmentInput,
  ): MissionHeroCommitment {
    if (
      !sameMissionCommitment(previous, input) ||
      previous.status !== 'ACTIVE' ||
      previous.expiresAt <= new Date()
    ) {
      throw new MissionCommitmentConflictError()
    }
    return toCommitment(previous)
  }

  private async writeGate(
    key: string,
    prior: HeroMissionGate | null,
    operationId: string | null,
    expiresAt: Date | null,
    session: ClientSession,
  ): Promise<void> {
    if (prior === null) {
      await this.gates.insertOne(
        { _id: key, revision: new Int32(1), operationId, expiresAt },
        { session },
      )
      return
    }
    const result = await this.gates.replaceOne(
      { _id: key, revision: prior.revision },
      { revision: new Int32(Number(prior.revision) + 1), operationId, expiresAt },
      { session },
    )
    if (result.matchedCount !== 1) throw new MissionCommitmentConcurrentError()
  }

  private async inTransaction<T>(action: (session: ClientSession) => Promise<T>): Promise<T> {
    return this.db.client.withSession(async (session) => {
      return session.withTransaction(() => action(session))
    })
  }
}
