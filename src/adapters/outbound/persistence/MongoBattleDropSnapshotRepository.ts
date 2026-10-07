import { randomUUID } from 'node:crypto'
import { Int32, type Collection, type Db } from 'mongodb'

import {
  BattleDropSnapshotConflictError,
  BattleDropSnapshotRejectedError,
  type BattleDropEquipment,
  type BattleDropSnapshot,
  type BattleDropSnapshotCommand,
  type BattleDropSnapshotPort,
} from '../../../application/ports/BattleDropSnapshotPort'
import { documentId, type HeroLoadoutDocument } from './hero-loadout-mapping'
import type { InventoryDocument } from './mapping'
import type { BattleDropUnitDocument } from './MongoBattleDropTransferRepository'

interface SnapshotDocument {
  readonly _id: string
  readonly fingerprint: string
  readonly snapshot: BattleDropSnapshot
}

const snapshotId = (battleId: string, playerId: string): string => `${battleId}::${playerId}`
const fingerprintOf = (command: BattleDropSnapshotCommand): string => JSON.stringify(command)

/**
 * Materializa solo las unidades efectivamente equipadas. La cantidad legada
 * sigue siendo la vista de inventario; el registro de unidad da la identidad
 * física que HU-30 necesita sin convertir cada grant histórico en miles de
 * documentos. La escritura de revision del inventario serializa la asignación
 * frente a grants y retiradas concurrentes.
 */
export class MongoBattleDropSnapshotRepository implements BattleDropSnapshotPort {
  private readonly snapshots: Collection<SnapshotDocument>
  private readonly units: Collection<BattleDropUnitDocument>
  private readonly inventories: Collection<InventoryDocument>
  private readonly loadouts: Collection<HeroLoadoutDocument>

  constructor(private readonly db: Db) {
    this.snapshots = db.collection<SnapshotDocument>('battle-drop-snapshots')
    this.units = db.collection<BattleDropUnitDocument>('battle-drop-units')
    this.inventories = db.collection<InventoryDocument>('inventories')
    this.loadouts = db.collection<HeroLoadoutDocument>('hero-loadouts')
  }

  async find(battleId: string, playerId: string): Promise<BattleDropSnapshot | null> {
    const document = await this.snapshots.findOne({ _id: snapshotId(battleId, playerId) })
    return document?.snapshot ?? null
  }

  async closeBattle(battleId: string): Promise<void> {
    await this.units.updateMany({ battleId }, { $set: { battleId: '', heroId: '', slot: '' } })
  }

  async capture(command: BattleDropSnapshotCommand): Promise<BattleDropSnapshot> {
    const fingerprint = fingerprintOf(command)
    return this.db.client.withSession(async (session) =>
      session.withTransaction(
        async () => {
          const previous = await this.snapshots.findOne(
            { _id: snapshotId(command.battleId, command.playerId) },
            { session },
          )
          if (previous !== null) {
            if (previous.fingerprint !== fingerprint) throw new BattleDropSnapshotConflictError()
            return previous.snapshot
          }

          const commitment = await this.db.collection('battle-hero-commitments').findOne(
            {
              playerId: command.playerId,
              heroId: command.heroId,
              reference: command.battleId,
              status: 'ACTIVE',
              expiresAt: { $gt: new Date() },
            },
            { session },
          )
          if (commitment === null) {
            throw new BattleDropSnapshotRejectedError('NO_ACTIVE_COMMITMENT')
          }

          const loadout = await this.loadouts.findOne(
            { _id: documentId(command.playerId, command.heroId) },
            { session },
          )
          if (
            Number(loadout?.version ?? 0) !== command.loadoutVersion ||
            command.equipment.some(
              (entry) =>
                !loadout?.entries.some(
                  (actual) =>
                    actual.slot === entry.slot &&
                    actual.itemId === entry.itemId &&
                    actual.productId === entry.productId,
                ),
            ) ||
            (loadout?.entries.length ?? 0) !== command.equipment.length
          ) {
            throw new BattleDropSnapshotRejectedError('LOADOUT_CHANGED')
          }

          const inventory = await this.inventories.findOne({ _id: command.playerId }, { session })
          if (inventory === null) throw new BattleDropSnapshotRejectedError('UNIT_UNAVAILABLE')

          const equipment: BattleDropEquipment[] = []
          for (const entry of command.equipment) {
            const quantity = Number(
              inventory.slots.find((slot) => slot.itemId === entry.itemId)?.quantity ?? 0,
            )
            if (quantity < 1) throw new BattleDropSnapshotRejectedError('UNIT_UNAVAILABLE')

            let unit = await this.units.findOne(
              {
                ownerId: command.playerId,
                itemId: entry.itemId,
                heroId: command.heroId,
                slot: entry.slot,
                battleId: command.battleId,
              },
              { session },
            )
            unit ??= await this.units.findOne(
              { ownerId: command.playerId, itemId: entry.itemId, battleId: '' },
              { session },
            )
            if (unit === null) {
              const alreadyIdentified = await this.units.countDocuments(
                { ownerId: command.playerId, itemId: entry.itemId },
                { session },
              )
              if (alreadyIdentified >= quantity) {
                throw new BattleDropSnapshotRejectedError('UNIT_UNAVAILABLE')
              }
              unit = {
                _id: randomUUID(),
                ownerId: command.playerId,
                itemId: entry.itemId,
                productId: entry.productId,
                battleId: command.battleId,
                heroId: command.heroId,
                slot: entry.slot,
              }
              await this.units.insertOne(unit, { session })
            } else {
              await this.units.updateOne(
                { _id: unit._id, ownerId: command.playerId },
                {
                  $set: {
                    battleId: command.battleId,
                    heroId: command.heroId,
                    slot: entry.slot,
                    productId: entry.productId,
                  },
                },
                { session },
              )
            }
            equipment.push({ ...entry, productInstanceId: unit._id })
          }

          const revision = Number(inventory.revision ?? 0)
          const touched = await this.inventories.updateOne(
            { _id: inventory._id, revision: inventory.revision },
            { $set: { revision: new Int32(revision + 1) } },
            { session },
          )
          if (touched.matchedCount !== 1) {
            throw new BattleDropSnapshotRejectedError('UNIT_UNAVAILABLE')
          }

          const snapshot: BattleDropSnapshot = {
            battleId: command.battleId,
            playerId: command.playerId,
            heroId: command.heroId,
            loadoutVersion: command.loadoutVersion,
            equipment,
          }
          await this.snapshots.insertOne(
            { _id: snapshotId(command.battleId, command.playerId), fingerprint, snapshot },
            { session },
          )
          return snapshot
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      ),
    )
  }
}
