import { randomUUID } from 'node:crypto'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import type { Db, MongoClient } from 'mongodb'

import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoInventoryRepository } from '../../src/adapters/outbound/persistence/MongoInventoryRepository'
import { MongoHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/MongoHeroLoadoutRepository'
import { MongoBattleHeroCommitmentRepository } from '../../src/adapters/outbound/persistence/MongoBattleHeroCommitmentRepository'
import { MongoBattleDropSnapshotRepository } from '../../src/adapters/outbound/persistence/MongoBattleDropSnapshotRepository'
import { MongoBattleDropTransferRepository } from '../../src/adapters/outbound/persistence/MongoBattleDropTransferRepository'
import { TransferBattleDrop } from '../../src/application/use-cases/TransferBattleDrop'
import { BattleDropTransferConflictError } from '../../src/application/ports/BattleDropTransferPort'
import { Inventory } from '../../src/domain/entities/Inventory'
import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../src/domain/value-objects/identifiers'

describe('HU-30: transferencia real de una instancia equipada', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    const externalUri = process.env.MONGO_TEST_URI
    if (externalUri === undefined) container = await new MongoDBContainer('mongo:8.0').start()
    const options = {
      uri: externalUri ?? `${container!.getConnectionString()}/?directConnection=true`,
      databaseName: `test_hu30_${randomUUID().replaceAll('-', '')}`,
    }
    client = createMongoClient(options)
    await client.connect()
    db = databaseOf(client, options)
    const migration = await migrateToLatest(db)
    if (migration.error !== undefined) {
      throw migration.error instanceof Error
        ? migration.error
        : new Error('La migración de prueba devolvió un error no tipado.')
    }
  }, 180_000)

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
    await container?.stop()
  })

  it('congela la unidad, la mueve una vez y limpia el loadout sin duplicar ownership', async () => {
    const sourceId = `source-${randomUUID()}`
    const targetId = `target-${randomUUID()}`
    const battleId = `battle-${randomUUID()}`
    const heroId = randomUUID()
    const productId = randomUUID()
    const itemId = 'espada-de-prueba'
    const operationId = randomUUID()

    const inventory = Inventory.createEmpty(PlayerId.create(sourceId), CapacityPolicy.default())
    inventory.add(ItemId.create(itemId), Quantity.create(1), new Date())
    const inventories = new MongoInventoryRepository(db)
    await inventories.save(inventory)

    const loadout = HeroLoadout.restore({
      ownerId: sourceId,
      heroId,
      version: 0,
      entries: [{ slot: 'WEAPON_1', itemId, productId }],
    })
    const savedLoadout = await new MongoHeroLoadoutRepository(db).save(loadout, 0)
    await new MongoBattleHeroCommitmentRepository(db).commit(
      {
        operationId: randomUUID(),
        playerId: sourceId,
        heroId,
        reference: battleId,
        expiresAt: new Date(Date.now() + 60_000),
      },
      new Date(),
    )

    const snapshot = await new MongoBattleDropSnapshotRepository(db).capture({
      battleId,
      playerId: sourceId,
      heroId,
      loadoutVersion: savedLoadout.version,
      equipment: [{ slot: 'WEAPON_1', itemId, productId, dropChanceBasisPoints: 500 }],
    })
    const instanceId = snapshot.equipment[0]?.productInstanceId
    expect(instanceId).toBeDefined()
    if (instanceId === undefined) throw new Error('No se materializó la instancia.')
    expect(
      (await inventories.findByOwner(PlayerId.create(sourceId)))?.quantityOf(ItemId.create(itemId)),
    ).toBe(1)
    expect(await inventories.findByOwner(PlayerId.create(targetId))).toBeNull()

    const command = {
      operationId,
      battleId,
      defeatEventSeq: 7,
      sourcePlayerId: sourceId,
      targetPlayerId: targetId,
      productInstanceId: instanceId,
    }
    const transfer = new TransferBattleDrop(new MongoBattleDropTransferRepository(db))
    const first = await transfer.execute(command)
    expect(await transfer.execute(command)).toEqual(first)
    expect(first.productInstanceId).toBe(instanceId)
    expect(
      (await inventories.findByOwner(PlayerId.create(sourceId)))?.quantityOf(ItemId.create(itemId)),
    ).toBe(0)
    expect(
      (await inventories.findByOwner(PlayerId.create(targetId)))?.quantityOf(ItemId.create(itemId)),
    ).toBe(1)
    expect(
      (
        await new MongoHeroLoadoutRepository(db).findByHero(PlayerId.create(sourceId), heroId)
      )?.isEmpty(),
    ).toBe(true)
    expect(
      (
        await db
          .collection<{ _id: string; ownerId: string }>('battle-drop-units')
          .findOne({ _id: instanceId })
      )?.ownerId,
    ).toBe(targetId)
    await expect(
      transfer.execute({ ...command, targetPlayerId: `another-${randomUUID()}` }),
    ).rejects.toBeInstanceOf(BattleDropTransferConflictError)
  })
})
