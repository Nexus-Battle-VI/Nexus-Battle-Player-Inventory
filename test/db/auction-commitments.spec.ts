import { randomUUID } from 'node:crypto'
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import type { Db, MongoClient } from 'mongodb'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoAuctionCommitmentRepository } from '../../src/adapters/outbound/persistence/MongoAuctionCommitmentRepository'
import { MongoHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/MongoHeroLoadoutRepository'
import { MongoInventoryRepository } from '../../src/adapters/outbound/persistence/MongoInventoryRepository'
import { Inventory } from '../../src/domain/entities/Inventory'
import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'
import { PlayerId } from '../../src/domain/value-objects/identifiers'
import {
  AuctionCommitmentConflictError,
  AuctionCommitmentRejectedError,
} from '../../src/application/ports/AuctionCommitmentPort'
import { MissionCommitmentConcurrentError } from '../../src/application/ports/MissionHeroCommitmentPort'

describe('Commitments Auction contra MongoDB', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db
  const seller = randomUUID()
  const product = randomUUID()
  const command = (suffix: string) => ({
    operationId: `auction:${suffix}:inventory:commit`,
    auctionId: suffix,
    ownerId: seller,
    productId: product,
    expiresAt: '2026-01-01T00:00:00.000Z',
  })
  beforeAll(async () => {
    const uri = process.env.MONGO_TEST_URI
    if (!uri) container = await new MongoDBContainer('mongo:8.0').start()
    const options = {
      uri: uri ?? `${container!.getConnectionString()}/?directConnection=true`,
      databaseName: `test_commitments_${randomUUID().replaceAll('-', '')}`,
    }
    client = createMongoClient(options)
    await client.connect()
    db = databaseOf(client, options)
    const result = await migrateToLatest(db)
    if (result.error instanceof Error) throw result.error
    if (result.error !== undefined) throw new Error('La migracion fallo.')
  }, 180000)
  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
    await container?.stop()
  })
  const seed = async (quantity: number) =>
    new MongoInventoryRepository(db).save(
      Inventory.restore({
        ownerId: PlayerId.create(seller),
        capacity: 30,
        slots: [{ itemId: product, quantity }],
      }),
    )
  it('persiste commit, replay/restart, conflicto y los indices de migration 007', async () => {
    await seed(1)
    const first = await new MongoAuctionCommitmentRepository(db).commit(command('one'))
    expect(first).toMatchObject({ status: 'ACTIVE', applied: true })
    expect(
      await db.collection('auction_commitments').findOne({ commitmentId: first.commitmentId }),
    ).toMatchObject({
      auctionId: 'one',
      ownerId: seller,
      productId: product,
      winnerId: null,
      status: 'ACTIVE',
    })
    expect(
      await db
        .collection('auction_commitment_operations')
        .countDocuments({ operationId: command('one').operationId }),
    ).toBe(1)
    const restarted = new MongoAuctionCommitmentRepository(db)
    expect(await restarted.commit(command('one'))).toMatchObject({
      commitmentId: first.commitmentId,
      applied: false,
    })
    await expect(
      restarted.commit({ ...command('one'), auctionId: 'changed' }),
    ).rejects.toBeInstanceOf(AuctionCommitmentConflictError)
    expect(
      (await new MongoInventoryRepository(db).findByOwner(PlayerId.create(seller)))?.totalUnits,
    ).toBe(0)
    const indexes = await db.collection('auction_commitments').indexes()
    expect(indexes.find((i) => i.key.commitmentId === 1)?.unique).toBe(true)
    expect(
      indexes.find((i) => i.key.ownerId === 1 && i.key.productId === 1 && i.key.status === 1)
        ?.unique,
    ).not.toBe(true)
    expect(
      (await db.collection('auction_commitment_operations').indexes()).find(
        (i) => i.key.operationId === 1,
      )?.unique,
    ).toBe(true)
  })
  it('permite quantity dos y rechaza un tercer commit sin crear resultado', async () => {
    const owner = randomUUID()
    const item = randomUUID()
    await new MongoInventoryRepository(db).save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: item, quantity: 2 }],
      }),
    )
    const repo = new MongoAuctionCommitmentRepository(db)
    const make = (n: string) => ({
      operationId: `auction:${n}:inventory:commit`,
      auctionId: n,
      ownerId: owner,
      productId: item,
      expiresAt: '2026-01-01T00:00:00.000Z',
    })
    const [a, b] = await Promise.all([repo.commit(make('a')), repo.commit(make('b'))])
    expect(a.commitmentId).not.toBe(b.commitmentId)
    await expect(repo.commit(make('c'))).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
    expect(await db.collection('auction_commitments').countDocuments({ ownerId: owner })).toBe(2)
  })
  it('no retira un heroe reservado y no reserva un heroe retirado por Auction', async () => {
    const owner = randomUUID()
    const heroId = randomUUID()
    await new MongoInventoryRepository(db).save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: heroId, quantity: 1 }],
      }),
    )
    const missions = new MongoHeroLoadoutRepository(db)
    const mission = {
      operationId: randomUUID(),
      playerId: owner,
      heroId,
      reference: 'enr-auction-race',
      expiresAt: new Date(Date.now() + 60_000),
      completeLoadout: false,
    }
    await missions.commit(mission, 0)

    const auction = new MongoAuctionCommitmentRepository(db)
    const auctionInput = {
      operationId: 'auction:mission-lock:inventory:commit',
      auctionId: 'mission-lock',
      ownerId: owner,
      productId: heroId,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }
    await expect(auction.commit(auctionInput)).rejects.toBeInstanceOf(
      AuctionCommitmentRejectedError,
    )
    expect(
      (await new MongoInventoryRepository(db).findByOwner(PlayerId.create(owner)))?.totalUnits,
    ).toBe(1)

    await missions.release(mission.operationId)
    await expect(auction.commit(auctionInput)).resolves.toMatchObject({ status: 'ACTIVE' })
    await expect(
      missions.commit({ ...mission, operationId: randomUUID() }, 0),
    ).rejects.toBeInstanceOf(MissionCommitmentConcurrentError)
  })
  it('no subasta equipamiento de un heroe reservado para Missions', async () => {
    const owner = randomUUID()
    const heroId = randomUUID()
    const weaponId = randomUUID()
    await new MongoInventoryRepository(db).save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [
          { itemId: heroId, quantity: 1 },
          { itemId: weaponId, quantity: 1 },
        ],
      }),
    )
    const missions = new MongoHeroLoadoutRepository(db)
    const loadout = HeroLoadout.createEmpty(owner, heroId)
    loadout.equip({
      slot: 'WEAPON_1',
      itemId: weaponId,
      productId: weaponId,
      category: 'WEAPON',
      occurredAt: new Date(),
    })
    await missions.save(loadout, 0)
    const missionOperation = randomUUID()
    await missions.commit(
      {
        operationId: missionOperation,
        playerId: owner,
        heroId,
        reference: 'enr-equipped',
        expiresAt: new Date(Date.now() + 60_000),
        completeLoadout: false,
      },
      1,
    )
    await expect(
      new MongoAuctionCommitmentRepository(db).commit({
        operationId: 'auction:equipped:inventory:commit',
        auctionId: 'equipped',
        ownerId: owner,
        productId: weaponId,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
    expect(
      (await new MongoInventoryRepository(db).findByOwner(PlayerId.create(owner)))?.totalUnits,
    ).toBe(2)

    await missions.release(missionOperation)
    await new MongoAuctionCommitmentRepository(db).commit({
      operationId: 'auction:equipped:inventory:commit',
      auctionId: 'equipped',
      ownerId: owner,
      productId: weaponId,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    })
    await expect(
      missions.commit(
        {
          operationId: randomUUID(),
          playerId: owner,
          heroId,
          reference: 'enr-stale-loadout',
          expiresAt: new Date(Date.now() + 60_000),
          completeLoadout: false,
        },
        1,
      ),
    ).rejects.toBeInstanceOf(MissionCommitmentConcurrentError)
  })
  it('release y pending claim son durables, idempotentes y no permiten transiciones inversas', async () => {
    const owner = randomUUID()
    const item = randomUUID()
    await new MongoInventoryRepository(db).save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: item, quantity: 2 }],
      }),
    )
    const repo = new MongoAuctionCommitmentRepository(db)
    const make = (auctionId: string) => ({
      operationId: `auction:${auctionId}:inventory:commit`,
      auctionId,
      ownerId: owner,
      productId: item,
      expiresAt: '2026-01-01T00:00:00.000Z',
    })
    const released = await repo.commit(make('release'))
    const release = {
      operationId: 'auction:release:inventory:release',
      commitmentId: released.commitmentId,
      auctionId: 'release',
      ownerId: owner,
      productId: item,
      reason: 'AUCTION_WITHOUT_BIDS' as const,
    }
    expect(await repo.release(release)).toMatchObject({ status: 'RELEASED', applied: true })
    expect(await new MongoAuctionCommitmentRepository(db).release(release)).toMatchObject({
      applied: false,
    })
    expect(
      (await new MongoInventoryRepository(db).findByOwner(PlayerId.create(owner)))?.totalUnits,
    ).toBe(2)
    await expect(
      repo.markPendingClaim({
        operationId: 'auction:release:inventory:pending-claim',
        commitmentId: released.commitmentId,
        auctionId: 'release',
        sellerId: owner,
        winnerId: randomUUID(),
        productId: item,
      }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
    const pending = await repo.commit(make('pending'))
    const transition = {
      operationId: 'auction:pending:inventory:pending-claim',
      commitmentId: pending.commitmentId,
      auctionId: 'pending',
      sellerId: owner,
      winnerId: randomUUID(),
      productId: item,
    }
    expect(await repo.markPendingClaim(transition)).toMatchObject({
      status: 'PENDING_CLAIM',
      applied: true,
    })
    expect(
      await new MongoAuctionCommitmentRepository(db).markPendingClaim(transition),
    ).toMatchObject({ applied: false, winnerId: transition.winnerId })
    await expect(
      repo.release({
        ...release,
        operationId: 'auction:pending:inventory:release',
        commitmentId: pending.commitmentId,
        auctionId: 'pending',
      }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
    expect(
      (await new MongoInventoryRepository(db).findByOwner(PlayerId.create(owner)))?.totalUnits,
    ).toBe(1)
  })
  it('serializa commits concurrentes y release idempotente sin duplicar unidades', async () => {
    const owner = randomUUID()
    const item = randomUUID()
    const inventory = new MongoInventoryRepository(db)
    await inventory.save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: item, quantity: 1 }],
      }),
    )
    const make = (n: string) => ({
      operationId: `auction:${n}:inventory:commit`,
      auctionId: n,
      ownerId: owner,
      productId: item,
      expiresAt: '2026-01-01T00:00:00.000Z',
    })
    const commands = [make('race-a'), make('race-b')]
    const results = await Promise.allSettled(
      commands.map((input) => new MongoAuctionCommitmentRepository(db).commit(input)),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const winnerIndex = results.findIndex((result) => result.status === 'fulfilled')
    const winner = results[winnerIndex]
    if (winner?.status !== 'fulfilled') throw new Error('No hubo commit ganador.')
    expect((await inventory.findByOwner(PlayerId.create(owner)))?.totalUnits).toBe(0)
    expect(
      await db
        .collection('auction_commitments')
        .countDocuments({ ownerId: owner, status: 'ACTIVE' }),
    ).toBe(1)
    const release = {
      operationId: 'auction:race:inventory:release',
      commitmentId: winner.value.commitmentId,
      auctionId: commands[winnerIndex]!.auctionId,
      ownerId: owner,
      productId: item,
      reason: 'AUCTION_WITHOUT_BIDS' as const,
    }
    const releases = await Promise.all([
      new MongoAuctionCommitmentRepository(db).release(release),
      new MongoAuctionCommitmentRepository(db).release(release),
    ])
    expect(releases.map((result) => result.applied).filter(Boolean)).toHaveLength(1)
    expect((await inventory.findByOwner(PlayerId.create(owner)))?.totalUnits).toBe(1)
  })
  it('claim entrega el producto al ganador, es idempotente y no permite reclamos dobles ni fuera de estado', async () => {
    const winner = randomUUID()
    const owner = randomUUID()
    const item = randomUUID()
    await new MongoInventoryRepository(db).save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: item, quantity: 1 }],
      }),
    )
    const repo = new MongoAuctionCommitmentRepository(db)
    const created = await repo.commit({
      operationId: 'auction:claim-case:inventory:commit',
      auctionId: 'claim-case',
      ownerId: owner,
      productId: item,
      expiresAt: '2026-01-01T00:00:00.000Z',
    })
    const claimInput = {
      operationId: 'auction:claim-case:inventory:claim',
      commitmentId: created.commitmentId,
      auctionId: 'claim-case',
      winnerId: winner,
      productId: item,
    }
    await expect(repo.claim(claimInput)).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
    await repo.markPendingClaim({
      operationId: 'auction:claim-case:inventory:pending-claim',
      commitmentId: created.commitmentId,
      auctionId: 'claim-case',
      sellerId: owner,
      winnerId: winner,
      productId: item,
    })
    const claimed = await repo.claim(claimInput)
    expect(claimed).toMatchObject({ status: 'CLAIMED', winnerId: winner, applied: true })
    expect(
      (await new MongoInventoryRepository(db).findByOwner(PlayerId.create(winner)))?.totalUnits,
    ).toBe(1)
    expect(
      await new MongoAuctionCommitmentRepository(db).claim(claimInput),
    ).toMatchObject({ applied: false, status: 'CLAIMED' })
    await expect(
      repo.claim({ ...claimInput, operationId: 'auction:claim-case:inventory:claim:retry' }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
    await expect(
      repo.release({
        operationId: 'auction:claim-case:inventory:release',
        commitmentId: created.commitmentId,
        auctionId: 'claim-case',
        ownerId: owner,
        productId: item,
        reason: 'AUCTION_WITHOUT_BIDS',
      }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
    expect(
      await db.collection('auction_commitments').findOne({ commitmentId: created.commitmentId }),
    ).toMatchObject({ status: 'CLAIMED', winnerId: winner })
  })
  it('acepta dos commits concurrentes cuando existen dos unidades', async () => {
    const owner = randomUUID()
    const item = randomUUID()
    await new MongoInventoryRepository(db).save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: item, quantity: 2 }],
      }),
    )
    const make = (auctionId: string) => ({
      operationId: `auction:${auctionId}:inventory:commit`,
      auctionId,
      ownerId: owner,
      productId: item,
      expiresAt: '2026-01-01T00:00:00.000Z',
    })
    const [left, right] = await Promise.all([
      new MongoAuctionCommitmentRepository(db).commit(make('quantity-two-a')),
      new MongoAuctionCommitmentRepository(db).commit(make('quantity-two-b')),
    ])
    expect(left.commitmentId).not.toBe(right.commitmentId)
    expect([left.status, right.status]).toEqual(['ACTIVE', 'ACTIVE'])
    expect(
      (await new MongoInventoryRepository(db).findByOwner(PlayerId.create(owner)))?.totalUnits,
    ).toBe(0)
    expect(
      await db
        .collection('auction_commitment_operations')
        .countDocuments({ operationId: { $in: [left.operationId, right.operationId] } }),
    ).toBe(2)
  })
})
