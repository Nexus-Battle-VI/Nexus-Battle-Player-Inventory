import { InMemoryAuctionCommitmentRepository } from '../../src/adapters/outbound/persistence/InMemoryAuctionCommitmentRepository'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { Inventory } from '../../src/domain/entities/Inventory'
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
  it('entrega el producto al ganador, reproduce el claim y no permite reclamar dos veces', async () => {
    const { inventories, repository } = await setup()
    const created = await repository.commit(commit())
    await repository.markPendingClaim({
      operationId: 'auction:a:inventory:pending-claim',
      commitmentId: created.commitmentId,
      auctionId: 'a',
      sellerId: owner,
      winnerId: 'winner',
      productId: product,
    })
    const claimInput = {
      operationId: 'auction:a:inventory:claim',
      commitmentId: created.commitmentId,
      auctionId: 'a',
      winnerId: 'winner',
      productId: product,
    }
    const claimed = await repository.claim(claimInput)
    expect(claimed).toMatchObject({ status: 'CLAIMED', winnerId: 'winner', applied: true })
    expect(
      (await inventories.findByOwner(PlayerId.create('winner')))?.quantityOf({
        value: product,
      } as never),
    ).toBe(1)
    const replay = await repository.claim(claimInput)
    expect(replay).toMatchObject({ ...claimed, applied: false })
    await expect(
      repository.claim({ ...claimInput, operationId: 'auction:a:inventory:claim:retry' }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
  })
  it('rechaza reclamar un commitment que aun no esta en pending claim', async () => {
    const { repository } = await setup()
    const created = await repository.commit(commit())
    await expect(
      repository.claim({
        operationId: 'auction:a:inventory:claim',
        commitmentId: created.commitmentId,
        auctionId: 'a',
        winnerId: 'winner',
        productId: product,
      }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
  })
  it('rechaza reclamar con un winnerId que no coincide con el commitment', async () => {
    const { repository } = await setup()
    const created = await repository.commit(commit())
    await repository.markPendingClaim({
      operationId: 'auction:a:inventory:pending-claim',
      commitmentId: created.commitmentId,
      auctionId: 'a',
      sellerId: owner,
      winnerId: 'winner',
      productId: product,
    })
    await expect(
      repository.claim({
        operationId: 'auction:a:inventory:claim',
        commitmentId: created.commitmentId,
        auctionId: 'a',
        winnerId: 'other-player',
        productId: product,
      }),
    ).rejects.toBeInstanceOf(AuctionCommitmentRejectedError)
  })
})
