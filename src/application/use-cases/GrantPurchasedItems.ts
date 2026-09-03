import { DomainError } from '../../domain/errors/DomainError'
import { PlayerId, Quantity } from '../../domain/value-objects/identifiers'
import type {
  InventoryGrantCommand,
  InventoryGrantPort,
  InventoryGrantResult,
} from '../ports/InventoryGrantPort'

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** La firma autentica al servicio; este caso valida el contrato de compra. */
export class GrantPurchasedItems {
  constructor(private readonly grants: InventoryGrantPort) {}

  execute(command: InventoryGrantCommand): Promise<InventoryGrantResult> {
    if (
      !UUID_PATTERN.test(command.operationId) ||
      command.items.length === 0 ||
      command.items.length > 200
    ) {
      throw new DomainError('La operacion requiere UUID y entre 1 y 200 productos.')
    }

    const seen = new Set<string>()
    const items = command.items
      .map((item) => {
        const productId = item.productId.toLowerCase()
        if (!UUID_PATTERN.test(productId) || seen.has(productId)) {
          throw new DomainError('Cada producto debe tener un UUID distinto.')
        }
        seen.add(productId)
        return { productId, quantity: Quantity.create(item.quantity).value }
      })
      .sort((a, b) => a.productId.localeCompare(b.productId))

    return this.grants.grant({
      operationId: command.operationId.toLowerCase(),
      playerId: PlayerId.create(command.playerId).value,
      items,
    })
  }
}

export const GRANT_PURCHASED_ITEMS = Symbol('GrantPurchasedItems')
