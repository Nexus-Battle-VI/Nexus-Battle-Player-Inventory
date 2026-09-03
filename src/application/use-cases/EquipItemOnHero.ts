import { HeroLoadout } from '../../domain/entities/HeroLoadout'
import type { ClockPort } from '../ports/ClockPort'
import {
  ARMOR_SLOT_BY_EQUIPMENT_SLOT,
  categoryOfSlot,
  equipmentCategoryOfProductType,
  parseEquipmentSlot,
} from '../../domain/value-objects/equipment'
import { parseEquippableAttributes } from '../../domain/value-objects/equipment-effects'
import { InvalidEquipmentSlotError } from '../../domain/entities/HeroLoadout'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroEquipmentDto } from '../dto/HeroEquipmentDto'
import {
  EquipmentProductNotOwnedError,
  EquipmentSlotMismatchError,
  InvalidEquipmentTypeError,
} from '../errors/ApplicationError'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { assembleEquipmentView, resolveOwnedHero } from './hero-equipment-shared'

export interface EquipItemOnHeroCommand {
  readonly ownerId: string
  readonly heroReference: string
  readonly slot: string
  readonly productReference: string
}

/**
 * Equipa un producto propio en una ranura de un heroe propio (RF-28, CA-01..CA-08).
 *
 * Orden estricto: VALIDAR TODO -> CALCULAR ESTADO RESULTANTE -> PERSISTIR DE
 * FORMA CONSISTENTE -> RESPONDER. Los servicios externos (Catalog) se consultan
 * ANTES de la escritura local; la escritura de la fuente de verdad del loadout
 * es una unica operacion atomica con bloqueo optimista. Ningun rechazo deja
 * estado parcial: si algo falla, no se ha escrito nada.
 *
 * Este caso de uso es el punto UNICO de equipamiento: HU-29 podra anteponerle
 * un guard de estado de batalla sin duplicar el proceso.
 */
export class EquipItemOnHero {
  private readonly inventories: InventoryQueryPort
  private readonly catalog: CatalogReadPort
  private readonly loadouts: HeroLoadoutRepositoryPort
  private readonly clock: ClockPort

  constructor(
    inventories: InventoryQueryPort,
    catalog: CatalogReadPort,
    loadouts: HeroLoadoutRepositoryPort,
    clock: ClockPort,
  ) {
    this.inventories = inventories
    this.catalog = catalog
    this.loadouts = loadouts
    this.clock = clock
  }

  async execute(command: EquipItemOnHeroCommand): Promise<HeroEquipmentDto> {
    const owner = PlayerId.create(command.ownerId)
    const slot = parseEquipmentSlot(command.slot)
    const productReference = command.productReference.trim()
    const deps = { inventories: this.inventories, catalog: this.catalog }

    // 1. El heroe pertenece al jugador y es un HEROE canonico.
    const hero = await resolveOwnedHero(deps, owner, command.heroReference)

    // 2. El producto pertenece al inventario del jugador.
    const owned = await this.inventories.findAllOwnedItems(owner)
    const ownedRefs = new Set(owned.map((item) => item.itemId))

    const product = await this.catalog.getByReference(productReference)
    if (product === null) {
      throw new EquipmentProductNotOwnedError(productReference)
    }
    const ownedItemId = ownedRefs.has(productReference)
      ? productReference
      : ownedRefs.has(product.sku)
        ? product.sku
        : null
    if (ownedItemId === null) {
      throw new EquipmentProductNotOwnedError(productReference)
    }

    // 3. El tipo del producto es equipable y su familia casa con la ranura.
    const category = equipmentCategoryOfProductType(product.type)
    if (category === null) {
      throw new InvalidEquipmentTypeError(productReference, product.type)
    }
    if (categoryOfSlot(slot) !== category) {
      throw new InvalidEquipmentSlotError(slot, category)
    }

    // 4. Para armadura, la ranura canonica de la pieza debe coincidir.
    if (category === 'ARMOR') {
      const expected = ARMOR_SLOT_BY_EQUIPMENT_SLOT[slot]
      const actual = parseEquippableAttributes(product.attributes).armorSlot
      if (expected === undefined || actual !== expected) {
        throw new EquipmentSlotMismatchError(slot, expected ?? 'DESCONOCIDA', actual)
      }
    }

    // 5. Estado resultante: el agregado aplica capacidades 2/6/2, "una pieza por
    //    ranura exacta" y la prohibicion de reemplazo silencioso.
    const loadout =
      (await this.loadouts.findByHero(owner, hero.heroProduct.productId)) ??
      HeroLoadout.createEmpty(owner.value, hero.heroProduct.productId)
    const expectedVersion = loadout.version

    loadout.equip({
      slot,
      itemId: ownedItemId,
      productId: product.productId,
      category,
      occurredAt: this.clock.now(),
    })

    // 6. Persistencia atomica con bloqueo optimista (lanza HeroLoadoutConflictError).
    const saved = await this.loadouts.save(loadout, expectedVersion)

    // 7. Nuevo estado consistente, suficiente para refrescar la interfaz.
    return assembleEquipmentView(deps, hero, saved)
  }
}
