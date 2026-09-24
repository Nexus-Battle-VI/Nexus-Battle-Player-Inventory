import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { GetAuctionProductEligibility } from '../../src/application/use-cases/GetAuctionProductEligibility'
import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'
import { Inventory } from '../../src/domain/entities/Inventory'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../src/domain/value-objects/identifiers'

const owner = PlayerId.create('player-1')
const productId = '123e4567-e89b-42d3-a456-426614174000'

const setup = async (equipped = false, quantity = 1) => {
  const inventories = new InMemoryInventoryRepository()
  const loadouts = new InMemoryHeroLoadoutRepository()
  if (quantity > 0) {
    const inventory = Inventory.createEmpty(owner, CapacityPolicy.default())
    inventory.add(ItemId.create(productId), Quantity.create(quantity), new Date())
    await inventories.save(inventory)
  }
  if (equipped) {
    const loadout = HeroLoadout.createEmpty(owner.value, 'hero-1')
    loadout.equip({
      slot: 'WEAPON_1',
      itemId: productId,
      productId,
      category: 'WEAPON',
      occurredAt: new Date(),
    })
    await loadouts.save(loadout, 0)
  }
  return new GetAuctionProductEligibility(inventories, loadouts)
}

describe('GetAuctionProductEligibility', () => {
  it.each([
    ['poseido y libre', false, 1, true, false],
    ['poseido y equipado', true, 2, true, true],
    ['no poseido', false, 0, false, false],
  ])('%s', async (_name, equipped, quantity, ownedByPlayer, inUse) => {
    const useCase = await setup(equipped, quantity)
    await expect(useCase.execute(owner.value, productId)).resolves.toEqual({
      ownerId: owner.value,
      productId,
      ownedByPlayer,
      inUse,
    })
  })

  it('trata un inventario inexistente como no poseido', async () => {
    const useCase = new GetAuctionProductEligibility(
      new InMemoryInventoryRepository(),
      new InMemoryHeroLoadoutRepository(),
    )
    await expect(useCase.execute(owner.value, productId)).resolves.toMatchObject({
      ownedByPlayer: false,
      inUse: false,
    })
  })
})
