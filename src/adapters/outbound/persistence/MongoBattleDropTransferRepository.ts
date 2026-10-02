import { Int32, MongoServerError, type ClientSession, type Collection, type Db } from 'mongodb'

import { Inventory } from '../../../domain/entities/Inventory'
import { DomainError } from '../../../domain/errors/DomainError'
import { CapacityPolicy } from '../../../domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../../domain/value-objects/identifiers'
import {
  BattleDropTransferConflictError,
  BattleDropTransferRejectedError,
  type BattleDropTransferCommand,
  type BattleDropTransferPort,
  type BattleDropTransferResult,
} from '../../../application/ports/BattleDropTransferPort'
import { toDocument, toSnapshot, type InventoryDocument } from './mapping'
import type { HeroLoadoutDocument } from './hero-loadout-mapping'

/** Identidad materializada al congelar el equipamiento para la batalla. */
export interface BattleDropUnitDocument {
  readonly _id: string
  readonly itemId: string
  readonly productId: string
  readonly ownerId: string
  readonly battleId: string
  readonly heroId: string
  readonly slot: string
}

interface TransferDocument {
  readonly _id: string
  readonly fingerprint: string
  readonly result: BattleDropTransferResult
}

const fingerprintOf = (command: BattleDropTransferCommand): string => JSON.stringify(command)

/**
 * Una transacción Mongo cubre ambos inventarios, la identidad de unidad, las
 * referencias de loadout y el ledger de idempotencia. Una respuesta perdida se
 * recupera leyendo el mismo operationId; no se hace remove + grant remoto.
 */
export class MongoBattleDropTransferRepository implements BattleDropTransferPort {
  private readonly units: Collection<BattleDropUnitDocument>
  private readonly transfers: Collection<TransferDocument>
  private readonly inventories: Collection<InventoryDocument>
  private readonly loadouts: Collection<HeroLoadoutDocument>

  constructor(private readonly db: Db) {
    this.units = db.collection<BattleDropUnitDocument>('battle-drop-units')
    this.transfers = db.collection<TransferDocument>('battle-drop-transfers')
    this.inventories = db.collection<InventoryDocument>('inventories')
    this.loadouts = db.collection<HeroLoadoutDocument>('hero-loadouts')
  }

  async transfer(command: BattleDropTransferCommand): Promise<BattleDropTransferResult> {
    const fingerprint = fingerprintOf(command)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.client.withSession(async (session) =>
          session.withTransaction(
            async () => {
              const previous = await this.transfers.findOne(
                { _id: command.operationId },
                { session },
              )
              if (previous !== null) {
                if (previous.fingerprint !== fingerprint)
                  throw new BattleDropTransferConflictError()
                return previous.result
              }

              const unit = await this.units.findOne({ _id: command.productInstanceId }, { session })
              if (unit?.ownerId !== command.sourcePlayerId || unit.battleId !== command.battleId) {
                throw new BattleDropTransferRejectedError('INSTANCE_NOT_OWNED')
              }

              const sourceDoc = await this.inventories.findOne(
                { _id: command.sourcePlayerId },
                { session },
              )
              const targetDoc = await this.inventories.findOne(
                { _id: command.targetPlayerId },
                { session },
              )
              if (sourceDoc === null) {
                throw new BattleDropTransferRejectedError('INSTANCE_NOT_OWNED')
              }

              const sourceSnapshot = toSnapshot(sourceDoc)
              const targetSnapshot = targetDoc === null ? null : toSnapshot(targetDoc)
              const source = Inventory.restore({
                ownerId: PlayerId.create(command.sourcePlayerId),
                capacity: sourceSnapshot.capacity,
                slots: sourceSnapshot.slots,
              })
              const target =
                targetSnapshot === null
                  ? Inventory.createEmpty(
                      PlayerId.create(command.targetPlayerId),
                      CapacityPolicy.default(),
                    )
                  : Inventory.restore({
                      ownerId: PlayerId.create(command.targetPlayerId),
                      capacity: targetSnapshot.capacity,
                      slots: targetSnapshot.slots,
                    })
              const item = ItemId.create(unit.itemId)
              if (source.quantityOf(item) < 1) {
                throw new BattleDropTransferRejectedError('INSTANCE_NOT_OWNED')
              }
              source.remove(item, Quantity.create(1), new Date())
              try {
                target.add(item, Quantity.create(1), new Date())
              } catch (error: unknown) {
                if (error instanceof DomainError) {
                  throw new BattleDropTransferRejectedError('TARGET_CAPACITY')
                }
                throw error
              }

              await this.replaceInventory(sourceDoc, source, session)
              if (targetDoc === null) {
                await this.inventories.insertOne(
                  { ...toDocument(target.toSnapshot()), revision: new Int32(1) },
                  { session },
                )
              } else {
                await this.replaceInventory(targetDoc, target, session)
              }

              // La pieza concreta seleccionada sale de su ranura, incluso si
              // el origen aún posee otra unidad del mismo producto.
              if (source.quantityOf(item) === 0) {
                await this.loadouts.updateMany(
                  { ownerId: command.sourcePlayerId, 'entries.itemId': unit.itemId },
                  { $pull: { entries: { itemId: unit.itemId } }, $inc: { version: 1 } },
                  { session },
                )
              } else {
                await this.loadouts.updateOne(
                  {
                    ownerId: command.sourcePlayerId,
                    heroId: unit.heroId,
                    'entries.slot': unit.slot,
                    'entries.itemId': unit.itemId,
                  },
                  {
                    $pull: { entries: { slot: unit.slot, itemId: unit.itemId } },
                    $inc: { version: 1 },
                  },
                  { session },
                )
              }
              const moved = await this.units.updateOne(
                { _id: unit._id, ownerId: command.sourcePlayerId },
                { $set: { ownerId: command.targetPlayerId, battleId: '', heroId: '', slot: '' } },
                { session },
              )
              if (moved.matchedCount !== 1) {
                throw new BattleDropTransferRejectedError('INSTANCE_NOT_OWNED')
              }

              const result: BattleDropTransferResult = {
                ...command,
                productId: unit.productId,
                itemId: unit.itemId,
                creditedAt: new Date().toISOString(),
                applied: true,
              }
              await this.transfers.insertOne(
                { _id: command.operationId, fingerprint, result },
                { session },
              )
              return result
            },
            { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
          ),
        )
      } catch (error: unknown) {
        if (error instanceof MongoServerError && error.code === 11000 && attempt < 2) continue
        throw error
      }
    }
    throw new Error('No se pudo confirmar la transferencia concurrente.')
  }

  private async replaceInventory(
    before: InventoryDocument,
    after: Inventory,
    session: ClientSession,
  ): Promise<void> {
    const revision = Number(before.revision ?? 0)
    const saved = await this.inventories.replaceOne(
      { _id: before._id, revision: before.revision },
      { ...toDocument(after.toSnapshot()), revision: new Int32(revision + 1) },
      { session },
    )
    if (saved.matchedCount !== 1) throw new Error('Conflicto concurrente de inventario.')
  }
}
