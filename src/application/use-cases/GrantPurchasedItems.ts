import { DomainError } from '../../domain/errors/DomainError'
import { PlayerId, Quantity } from '../../domain/value-objects/identifiers'
import { parseHeroAttributes } from '../../domain/value-objects/equipment-effects'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type {
  InventoryGrantCommand,
  InventoryGrantPort,
  InventoryGrantResult,
} from '../ports/InventoryGrantPort'

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface GrantedItem {
  readonly productId: string
  readonly quantity: number
}

/** La firma autentica al servicio; este caso valida el contrato de compra. */
export class GrantPurchasedItems {
  constructor(
    private readonly grants: InventoryGrantPort,
    private readonly catalog: CatalogReadPort,
  ) {}

  async execute(command: InventoryGrantCommand): Promise<InventoryGrantResult> {
    if (
      !UUID_PATTERN.test(command.operationId) ||
      command.items.length === 0 ||
      command.items.length > 200
    ) {
      throw new DomainError('La operacion requiere UUID y entre 1 y 200 productos.')
    }

    const seen = new Set<string>()
    const items: GrantedItem[] = command.items.map((item) => {
      const productId = item.productId.toLowerCase()
      if (!UUID_PATTERN.test(productId) || seen.has(productId)) {
        throw new DomainError('Cada producto debe tener un UUID distinto.')
      }
      seen.add(productId)
      return { productId, quantity: Quantity.create(item.quantity).value }
    })

    const bundled = await this.includedAbilities(items, seen)
    const allItems = [...items, ...bundled].sort((a, b) => a.productId.localeCompare(b.productId))

    if (allItems.length > 200) {
      throw new DomainError('La operacion requiere UUID y entre 1 y 200 productos.')
    }

    return this.grants.grant({
      operationId: command.operationId.toLowerCase(),
      playerId: PlayerId.create(command.playerId).value,
      items: allItems,
    })
  }

  /**
   * Una habilidad es intrinseca del heroe -aclaracion cliente/profesor,
   * 2026-09-27-: viene incluida al adquirirlo, nunca se compra por separado
   * (ver ECOMMERCE_ELIGIBLE_TYPES en Commerce). Cuando este lote entrega un
   * HEROE, se agregan gratis -sin pasar por Commerce ni por una reserva de
   * stock en Catalog- las habilidades activas que ese heroe declara en su
   * propio atributo canonico `abilities`.
   *
   * Si Catalog no responde, `getByReference` lanza `CatalogUnavailableError`
   * y la entrega completa falla con 503: se prefiere reintentar el lote
   * entero antes que entregar un heroe sin sus habilidades para siempre.
   */
  private async includedAbilities(
    items: readonly GrantedItem[],
    seen: Set<string>,
  ): Promise<GrantedItem[]> {
    const bundled: GrantedItem[] = []

    for (const item of items) {
      const product = await this.catalog.getByReference(item.productId)
      if (product === null) continue

      let hero
      try {
        hero = parseHeroAttributes(product.attributes)
      } catch {
        continue
      }

      for (const reference of hero.abilities) {
        const ability = await this.catalog.getByReference(reference)
        if (ability === null) continue
        if (ability.lifecycleStatus !== 'ACTIVE') continue
        if (seen.has(ability.productId)) continue

        seen.add(ability.productId)
        bundled.push({ productId: ability.productId, quantity: 1 })
      }
    }

    return bundled
  }
}

export const GRANT_PURCHASED_ITEMS = Symbol('GrantPurchasedItems')
