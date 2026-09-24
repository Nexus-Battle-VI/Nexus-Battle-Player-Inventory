import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import type { InventoryRepositoryPort } from '../ports/InventoryRepositoryPort'
import { ItemId, PlayerId } from '../../domain/value-objects/identifiers'

export interface AuctionProductEligibility {
  readonly ownerId: string
  readonly productId: string
  readonly ownedByPlayer: boolean
  readonly inUse: boolean
}

/** Consulta interna para Auction, sobre los agregados que ya son fuente de verdad. */
export class GetAuctionProductEligibility {
  constructor(
    private readonly inventories: InventoryRepositoryPort,
    private readonly loadouts: HeroLoadoutRepositoryPort,
  ) {}

  async execute(ownerId: string, productId: string): Promise<AuctionProductEligibility> {
    const owner = PlayerId.create(ownerId)
    const product = ItemId.create(productId)
    const inventory = await this.inventories.findByOwner(owner)
    const ownedByPlayer = inventory !== null && inventory.quantityOf(product) > 0
    if (!ownedByPlayer) {
      return { ownerId: owner.value, productId: product.value, ownedByPlayer: false, inUse: false }
    }
    const loadouts = await this.loadouts.findByOwner(owner)
    const inUse = loadouts.some((loadout) =>
      loadout.toSnapshot().entries.some((entry) => entry.productId === product.value),
    )
    return { ownerId: owner.value, productId: product.value, ownedByPlayer: true, inUse }
  }
}

export const GET_AUCTION_PRODUCT_ELIGIBILITY = Symbol('GetAuctionProductEligibility')
