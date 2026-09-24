import { InMemoryAuctionCommitmentRepository } from '../../src/adapters/outbound/persistence/InMemoryAuctionCommitmentRepository'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { Inventory } from '../../src/domain/entities/Inventory'
import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'
import { PlayerId } from '../../src/domain/value-objects/identifiers'
import { AuctionCommitmentRejectedError } from '../../src/application/ports/AuctionCommitmentPort'

const product = '11111111-1111-4111-8111-111111111111'
const owner = 'seller-a'
const commit = (operationId = 'auction:a:inventory:commit') => ({
  operationId,
  auctionId: 'a',
  ownerId: owner,
  productId: product,
  expiresAt: '2026-01-01T00:00:00.000Z',
})

describe('Auction commitments en memoria', () => {
  const setup = async (quantity = 1) => {
    const inventories = new InMemoryInventoryRepository()
    await inventories.save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: product, quantity }],
      }),
    )
    return { inventories, repository: new InMemoryAuctionCommitmentRepository(inventories) }
  }
  it('consume una unidad, reproduce el commit y no libera por expiresAt', async () => {
    const { inventories, repository } = await setup(2)
    const first = await repository.commit(commit())
    const replay = await repository.commit(commit())
    expect(first).toMatchObject({ status: 'ACTIVE', applied: true })
    expect(replay).toMatchObject({ commitmentId: first.commitmentId, applied: false })
    expect(
      (await inventories.findByOwner(PlayerId.create(owner)))?.quantityOf({
        value: product,
      } as never),
    ).toBe(1)
  })
  it('no retira un heroe que sigue reservado para Missions', async () => {
    const inventories = new InMemoryInventoryRepository()
    await inventories.save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: product, quantity: 1 }],
      }),
    )
    const missions = new InMemoryHeroLoadoutRepository()
    const operationId = crypto.randomUUID()
    await missions.commit(
      {
        operationId,
        playerId: owner,
        heroId: product,
        reference: 'enr-a',
        expiresAt: new Date(Date.now() + 60_000),
        completeLoadout: false,
      },
      0,
    )
    const auctions = new InMemoryAuctionCommitmentRepository(inventories, missions)
    await expect(auctions.commit(commit())).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
    await missions.release(operationId)
    await expect(auctions.commit(commit())).resolves.toMatchObject({ status: 'ACTIVE' })
  })
  it('no retira una pieza equipada por un heroe reservado para Missions', async () => {
    const heroId = '22222222-2222-4222-8222-222222222222'
    const inventories = new InMemoryInventoryRepository()
    await inventories.save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [
          { itemId: product, quantity: 1 },
          { itemId: heroId, quantity: 1 },
        ],
      }),
    )
    const missions = new InMemoryHeroLoadoutRepository()
    const loadout = HeroLoadout.createEmpty(owner, heroId)
    loadout.equip({
      slot: 'WEAPON_1',
      itemId: product,
      productId: product,
      category: 'WEAPON',
      occurredAt: new Date(),
    })
    await missions.save(loadout, 0)
    await missions.commit(
      {
        operationId: crypto.randomUUID(),
        playerId: owner,
        heroId,
        reference: 'enr-equipped',
        expiresAt: new Date(Date.now() + 60_000),
        completeLoadout: false,
      },
      1,
    )
    await expect(
      new InMemoryAuctionCommitmentRepository(inventories, missions).commit(commit()),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
  })
  it('permite dos unidades, libera una sola y no duplica replay', async () => {
    const { inventories, repository } = await setup(2)
    const one = await repository.commit(commit('auction:a:inventory:commit:1'))
    await repository.commit(commit('auction:b:inventory:commit:2'))
    const input = {
      operationId: 'auction:a:inventory:release',
      commitmentId: one.commitmentId,
      auctionId: 'a',
      ownerId: owner,
      productId: product,
      reason: 'AUCTION_WITHOUT_BIDS' as const,
    }
    expect((await repository.release(input)).status).toBe('RELEASED')
    expect((await repository.release(input)).applied).toBe(false)
    expect(
      (await inventories.findByOwner(PlayerId.create(owner)))?.quantityOf({
        value: product,
      } as never),
    ).toBe(1)
  })
  it('retiene el producto en pending claim y rechaza release', async () => {
    const { inventories, repository } = await setup()
    const created = await repository.commit(commit())
    const pending = await repository.markPendingClaim({
      operationId: 'auction:a:inventory:pending-claim',
      commitmentId: created.commitmentId,
      auctionId: 'a',
      sellerId: owner,
      winnerId: 'winner',
      productId: product,
    })
    expect(pending).toMatchObject({ status: 'PENDING_CLAIM', winnerId: 'winner' })
    expect((await inventories.findByOwner(PlayerId.create(owner)))?.toSnapshot().slots).toEqual([])
    await expect(
      repository.release({
        operationId: 'auction:a:inventory:release',
        commitmentId: created.commitmentId,
        auctionId: 'a',
        ownerId: owner,
        productId: product,
        reason: 'AUCTION_WITHOUT_BIDS',
      }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
  })
})
