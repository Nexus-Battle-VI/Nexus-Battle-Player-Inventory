import { MongoServerError, type Collection, type Db } from 'mongodb'

import type {
  BattleHeroCommitment,
  BattleHeroCommitmentInput,
  BattleHeroCommitmentPort,
} from '../../../application/ports/BattleHeroCommitmentPort'
import {
  BattleCommitmentConflictError,
  BattleHeroCommittedError,
  sameBattleCommitment,
} from '../../../application/ports/BattleHeroCommitmentPort'

interface BattleCommitmentDocument {
  readonly _id: string
  readonly operationId: string
  readonly playerId: string
  readonly heroId: string
  readonly reference: string
  readonly expiresAt: Date
  readonly commitmentId: string
  readonly status: 'ACTIVE' | 'RELEASED'
}

const toCommitment = (document: BattleCommitmentDocument): BattleHeroCommitment => ({
  operationId: document.operationId,
  playerId: document.playerId,
  heroId: document.heroId,
  reference: document.reference,
  expiresAt: document.expiresAt,
  commitmentId: document.commitmentId,
  status: document.status,
})

const DUPLICATE_KEY = 11000

/**
 * Compromisos de batalla en MongoDB (HU-29, contrato `hu-29-battle-commitment-v1`).
 *
 * `_id` ES el `operationId`: la idempotencia no se comprueba antes de escribir,
 * la impone el motor. Un indice unico parcial sobre `{playerId, heroId}` con
 * `status: 'ACTIVE'` impide que un heroe este en dos batallas a la vez, y al
 * liberar deja de cubrirlo, de modo que puede volver a comprometerse.
 *
 * NO HAY COLECCION DE EXCLUSION APARTE, a diferencia del compromiso de mision:
 * alli hace falta porque la reserva convive con el loadout y con Auction; aqui el
 * unico hecho que hay que sostener es «este heroe esta en una batalla», y el
 * indice parcial lo sostiene sin un segundo documento que pueda desincronizarse.
 */
export class MongoBattleHeroCommitmentRepository implements BattleHeroCommitmentPort {
  private readonly commitments: Collection<BattleCommitmentDocument>

  constructor(db: Db) {
    this.commitments = db.collection<BattleCommitmentDocument>('battle-hero-commitments')
  }

  async findByOperation(operationId: string): Promise<BattleHeroCommitment | null> {
    const document = await this.commitments.findOne({ _id: operationId })

    return document === null ? null : toCommitment(document)
  }

  async hasActiveForHero(playerId: string, heroId: string, now: Date): Promise<boolean> {
    const document = await this.commitments.findOne({
      playerId,
      heroId,
      status: 'ACTIVE',
      expiresAt: { $gt: now },
    })

    return document !== null
  }

  async commit(input: BattleHeroCommitmentInput, now: Date): Promise<BattleHeroCommitment> {
    // Un compromiso vencido deja de bloquear de verdad, no solo de nombre: se
    // libera de forma perezosa para que libere el indice parcial. Sin esto, una
    // liberacion perdida bloquearia al heroe para siempre.
    await this.commitments.updateMany(
      {
        playerId: input.playerId,
        heroId: input.heroId,
        status: 'ACTIVE',
        expiresAt: { $lte: now },
      },
      { $set: { status: 'RELEASED' } },
    )

    const document: BattleCommitmentDocument = {
      _id: input.operationId,
      operationId: input.operationId,
      playerId: input.playerId,
      heroId: input.heroId,
      reference: input.reference,
      expiresAt: input.expiresAt,
      // Determinista a proposito: la misma operacion devuelve siempre el mismo
      // compromiso, sin depender de un generador.
      commitmentId: `cmt_${input.operationId}`,
      status: 'ACTIVE',
    }

    try {
      await this.commitments.insertOne(document)
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
        const previous = await this.commitments.findOne({ _id: input.operationId })

        if (previous !== null) {
          return this.replay(previous, input, now)
        }

        // No es la clave: es el indice parcial, asi que el heroe ya esta en otra
        // batalla activa.
        throw new BattleHeroCommittedError()
      }

      throw error
    }

    return toCommitment(document)
  }

  async release(operationId: string): Promise<void> {
    await this.commitments.updateOne(
      { _id: operationId, status: 'ACTIVE' },
      { $set: { status: 'RELEASED' } },
    )
  }

  private replay(
    previous: BattleCommitmentDocument,
    input: BattleHeroCommitmentInput,
    now: Date,
  ): BattleHeroCommitment {
    if (
      !sameBattleCommitment(previous, input) ||
      previous.status !== 'ACTIVE' ||
      previous.expiresAt <= now
    ) {
      throw new BattleCommitmentConflictError()
    }

    return toCommitment(previous)
  }
}
