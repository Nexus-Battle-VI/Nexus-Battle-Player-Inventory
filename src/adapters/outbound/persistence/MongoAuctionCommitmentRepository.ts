import { randomUUID } from 'node:crypto'
import type { ClientSession, Db } from 'mongodb'
import { Int32, MongoServerError } from 'mongodb'
import { Inventory } from '../../../domain/entities/Inventory'
import { CapacityPolicy } from '../../../domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../../domain/value-objects/identifiers'
import type {
  AuctionCommitmentPort,
  AuctionCommitmentResult,
  ClaimAuctionCommitment,
  CreateAuctionCommitment,
  PendingAuctionCommitment,
  ReleaseAuctionCommitment,
} from '../../../application/ports/AuctionCommitmentPort'
import {
  AuctionCommitmentConflictError,
  AuctionCommitmentNotFoundError,
  AuctionCommitmentRejectedError,
  AuctionCommitmentStatus,
} from '../../../application/ports/AuctionCommitmentPort'
import { toDocument, toSnapshot, type InventoryDocument } from './mapping'
import { documentId, type HeroLoadoutDocument } from './hero-loadout-mapping'

interface HeroMissionGate {
  readonly _id: string
  readonly revision: Int32 | number
  readonly operationId: string | null
  readonly expiresAt: Date | null
}

interface Commitment {
  commitmentId: string
  auctionId: string
  ownerId: string
  productId: string
  winnerId: string | null
  status: AuctionCommitmentStatus
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}
interface Operation {
  operationId: string
  fingerprint: string
  result: AuctionCommitmentResult
  createdAt: Date
}
const fingerprint = (value: unknown) => JSON.stringify(value)

export class MongoAuctionCommitmentRepository implements AuctionCommitmentPort {
  constructor(private readonly db: Db) {}
  async commit(input: CreateAuctionCommitment): Promise<AuctionCommitmentResult> {
    return this.transaction(input.operationId, input, async (session) => {
      const inventoryDoc = await this.db
        .collection<InventoryDocument>('inventories')
        .findOne({ _id: input.ownerId }, { session })
      const item = ItemId.create(input.productId)
      if (!inventoryDoc)
        throw new AuctionCommitmentRejectedError('El vendedor no posee el producto.')
      const snapshot = toSnapshot(inventoryDoc)
      const inventory = Inventory.restore({
        ownerId: PlayerId.create(input.ownerId),
        capacity: snapshot.capacity,
        slots: snapshot.slots,
      })
      if (inventory.quantityOf(item) < 1)
        throw new AuctionCommitmentRejectedError('El vendedor no posee el producto.')
      // Auction retira el producto del inventario. Si es el heroe de una
      // mision, esta escritura comparte el gate de la reserva y evita que
      // ambas transacciones confirmen a partir de lecturas anteriores.
      const equippedBy = await this.db
        .collection<HeroLoadoutDocument>('hero-loadouts')
        .find({ ownerId: input.ownerId, 'entries.itemId': item.value }, { session })
        .toArray()
      const gateIds = new Set([
        documentId(input.ownerId, item.value),
        ...equippedBy.map((loadout) => loadout._id),
      ])
      for (const gateId of [...gateIds].sort()) {
        await this.touchMissionGate(gateId, session)
      }
      inventory.remove(item, Quantity.create(1), new Date())
      const next = {
        ...toDocument(inventory.toSnapshot()),
        revision: new Int32(Number(inventoryDoc.revision ?? 0) + 1),
      }
      const saved = await this.db
        .collection<InventoryDocument>('inventories')
        .replaceOne({ _id: input.ownerId, revision: inventoryDoc.revision }, next, { session })
      if (saved.matchedCount !== 1)
        throw new AuctionCommitmentConflictError('El inventario cambio durante la operacion.')
      const now = new Date()
      const commitment: Commitment = {
        commitmentId: randomUUID(),
        auctionId: input.auctionId,
        ownerId: input.ownerId,
        productId: input.productId,
        winnerId: null,
        status: AuctionCommitmentStatus.Active,
        expiresAt: new Date(input.expiresAt),
        createdAt: now,
        updatedAt: now,
      }
      await this.db.collection<Commitment>('auction_commitments').insertOne(commitment, { session })
      return {
        operationId: input.operationId,
        commitmentId: commitment.commitmentId,
        status: commitment.status,
        applied: true,
      }
    })
  }
  private async touchMissionGate(gateId: string, session: ClientSession): Promise<void> {
    const gates = this.db.collection<HeroMissionGate>('hero-mission-gates')
    const gate = await gates.findOne({ _id: gateId }, { session })
    if (gate?.operationId && gate.expiresAt && gate.expiresAt > new Date()) {
      throw new AuctionCommitmentRejectedError('El heroe esta reservado para una mision.')
    }
    if (gate === null) {
      await gates.insertOne(
        { _id: gateId, revision: new Int32(1), operationId: null, expiresAt: null },
        { session },
      )
      return
    }
    const touched = await gates.replaceOne(
      { _id: gateId, revision: gate.revision },
      {
        revision: new Int32(Number(gate.revision) + 1),
        operationId: gate.operationId,
        expiresAt: gate.expiresAt,
      },
      { session },
    )
    if (touched.matchedCount !== 1) {
      throw new AuctionCommitmentConflictError('El estado del heroe cambio durante la operacion.')
    }
  }
  async release(input: ReleaseAuctionCommitment): Promise<AuctionCommitmentResult> {
    return this.transition(input.operationId, input, async (c, session) => {
      if (c.status !== AuctionCommitmentStatus.Active)
        throw new AuctionCommitmentRejectedError(
          'El commitment no puede liberarse en su estado actual.',
        )
      const doc = await this.db
        .collection<InventoryDocument>('inventories')
        .findOne({ _id: c.ownerId }, { session })
      if (!doc) throw new AuctionCommitmentRejectedError('El inventario del vendedor no existe.')
      const s = toSnapshot(doc)
      const i = Inventory.restore({
        ownerId: PlayerId.create(c.ownerId),
        capacity: s.capacity,
        slots: s.slots,
      })
      i.add(ItemId.create(c.productId), Quantity.create(1), new Date())
      const saved = await this.db
        .collection<InventoryDocument>('inventories')
        .replaceOne(
          { _id: c.ownerId, revision: doc.revision },
          { ...toDocument(i.toSnapshot()), revision: new Int32(Number(doc.revision ?? 0) + 1) },
          { session },
        )
      if (saved.matchedCount !== 1)
        throw new AuctionCommitmentConflictError('El inventario cambio durante la operacion.')
      await this.db
        .collection<Commitment>('auction_commitments')
        .updateOne(
          { commitmentId: c.commitmentId },
          { $set: { status: AuctionCommitmentStatus.Released, updatedAt: new Date() } },
          { session },
        )
      return {
        operationId: input.operationId,
        commitmentId: c.commitmentId,
        status: AuctionCommitmentStatus.Released,
        applied: true,
      }
    })
  }
  async markPendingClaim(input: PendingAuctionCommitment): Promise<AuctionCommitmentResult> {
    return this.transition(input.operationId, input, async (c, session) => {
      if (c.status !== AuctionCommitmentStatus.Active)
        throw new AuctionCommitmentRejectedError(
          'El commitment no puede cambiar en su estado actual.',
        )
      await this.db.collection<Commitment>('auction_commitments').updateOne(
        { commitmentId: c.commitmentId },
        {
          $set: {
            status: AuctionCommitmentStatus.PendingClaim,
            winnerId: input.winnerId,
            updatedAt: new Date(),
          },
        },
        { session },
      )
      return {
        operationId: input.operationId,
        commitmentId: c.commitmentId,
        status: AuctionCommitmentStatus.PendingClaim,
        winnerId: input.winnerId,
        applied: true,
      }
    })
  }
  async claim(input: ClaimAuctionCommitment): Promise<AuctionCommitmentResult> {
    return this.transition(input.operationId, input, async (c, session) => {
      if (c.status !== AuctionCommitmentStatus.PendingClaim)
        throw new AuctionCommitmentRejectedError(
          'El commitment no puede reclamarse en su estado actual.',
        )
      const winner = PlayerId.create(input.winnerId)
      const doc = await this.db
        .collection<InventoryDocument>('inventories')
        .findOne({ _id: input.winnerId }, { session })
      const inventory =
        doc === null
          ? Inventory.createEmpty(winner, CapacityPolicy.default())
          : Inventory.restore({ ...toSnapshot(doc), ownerId: winner })
      inventory.add(ItemId.create(c.productId), Quantity.create(1), new Date())
      const next = {
        ...toDocument(inventory.toSnapshot()),
        revision: new Int32(Number(doc?.revision ?? 0) + 1),
      }
      if (doc === null) {
        await this.db.collection<InventoryDocument>('inventories').insertOne(next, { session })
      } else {
        const saved = await this.db
          .collection<InventoryDocument>('inventories')
          .replaceOne({ _id: input.winnerId, revision: doc.revision }, next, { session })
        if (saved.matchedCount !== 1)
          throw new AuctionCommitmentConflictError('El inventario cambio durante la operacion.')
      }
      await this.db
        .collection<Commitment>('auction_commitments')
        .updateOne(
          { commitmentId: c.commitmentId },
          { $set: { status: AuctionCommitmentStatus.Claimed, updatedAt: new Date() } },
          { session },
        )
      return {
        operationId: input.operationId,
        commitmentId: c.commitmentId,
        status: AuctionCommitmentStatus.Claimed,
        winnerId: input.winnerId,
        applied: true,
      }
    })
  }
  private async transition(
    id: string,
    input: ReleaseAuctionCommitment | PendingAuctionCommitment | ClaimAuctionCommitment,
    action: (c: Commitment, s: ClientSession) => Promise<AuctionCommitmentResult>,
  ): Promise<AuctionCommitmentResult> {
    return this.transaction(id, input, async (session) => {
      const c = await this.db
        .collection<Commitment>('auction_commitments')
        .findOne({ commitmentId: input.commitmentId }, { session })
      if (!c) throw new AuctionCommitmentNotFoundError()
      if (c.auctionId !== input.auctionId || c.productId !== input.productId)
        throw new AuctionCommitmentRejectedError('El intent no coincide con el commitment.')
      if ('ownerId' in input) {
        if (c.ownerId !== input.ownerId)
          throw new AuctionCommitmentRejectedError('El intent no coincide con el commitment.')
      } else if ('sellerId' in input) {
        if (c.ownerId !== input.sellerId)
          throw new AuctionCommitmentRejectedError('El intent no coincide con el commitment.')
      } else if (c.winnerId !== input.winnerId) {
        throw new AuctionCommitmentRejectedError('El intent no coincide con el commitment.')
      }
      return action(c, session)
    })
  }
  private async transaction(
    id: string,
    input: unknown,
    action: (session: ClientSession) => Promise<AuctionCommitmentResult>,
  ): Promise<AuctionCommitmentResult> {
    const fp = fingerprint(input)
    try {
      return await this.db.client.withSession(async (session) =>
        session.withTransaction(async () => {
          const old = await this.db
            .collection<Operation>('auction_commitment_operations')
            .findOne({ operationId: id }, { session })
          if (old) {
            if (old.fingerprint !== fp) throw new AuctionCommitmentConflictError()
            return { ...old.result, applied: false }
          }
          const result = await action(session)
          await this.db
            .collection<Operation>('auction_commitment_operations')
            .insertOne(
              { operationId: id, fingerprint: fp, result, createdAt: new Date() },
              { session },
            )
          return result
        }),
      )
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000)
        throw new AuctionCommitmentConflictError()
      throw error
    }
  }
}
