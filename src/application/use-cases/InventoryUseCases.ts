import { Inventory } from '../../domain/entities/Inventory'
import type { CapacityPolicy } from '../../domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../domain/value-objects/identifiers'
import type { ClockPort } from '../ports/ClockPort'
import type { InventoryRepositoryPort } from '../ports/InventoryRepositoryPort'
import { InventoryNotFoundError } from '../errors/ApplicationError'
import { type InventoryDto, toInventoryDto } from '../dto/InventoryDto'

export interface InventoryDependencies {
  readonly inventories: InventoryRepositoryPort
  readonly clock: ClockPort
  readonly defaultCapacity: CapacityPolicy
}

export interface ChangeInventoryCommand {
  readonly ownerId: string
  readonly itemId: string
  readonly quantity: number
}

/**
 * Recupera el inventario de un jugador.
 */
export class GetInventory {
  private readonly inventories: InventoryRepositoryPort

  constructor(inventories: InventoryRepositoryPort) {
    this.inventories = inventories
  }

  async execute(ownerId: string): Promise<InventoryDto> {
    const inventory = await this.inventories.findByOwner(PlayerId.create(ownerId))

    if (inventory === null) {
      throw new InventoryNotFoundError(ownerId)
    }

    return toInventoryDto(inventory.toSnapshot())
  }
}

/**
 * Anade unidades de un objeto al inventario de un jugador.
 *
 * Si el jugador todavia no tiene inventario, se crea vacio con la capacidad
 * por defecto. Un jugador sin inventario y un inventario vacio son el mismo
 * estado de negocio, y obligar a un alta previa solo anadiria un paso sin
 * significado para el jugador.
 */
export class AddItemToInventory {
  private readonly deps: InventoryDependencies

  constructor(deps: InventoryDependencies) {
    this.deps = deps
  }

  async execute(command: ChangeInventoryCommand): Promise<InventoryDto> {
    const ownerId = PlayerId.create(command.ownerId)
    const itemId = ItemId.create(command.itemId)
    const quantity = Quantity.create(command.quantity)

    const inventory =
      (await this.deps.inventories.findByOwner(ownerId)) ??
      Inventory.createEmpty(ownerId, this.deps.defaultCapacity)

    inventory.add(itemId, quantity, this.deps.clock.now())

    await this.deps.inventories.save(inventory)
    inventory.pullEvents()

    return toInventoryDto(inventory.toSnapshot())
  }
}

/**
 * Retira unidades de un objeto del inventario de un jugador.
 *
 * A diferencia del alta, aqui la ausencia de inventario si es un error: no se
 * puede retirar de lo que no existe.
 */
export class RemoveItemFromInventory {
  private readonly deps: InventoryDependencies

  constructor(deps: InventoryDependencies) {
    this.deps = deps
  }

  async execute(command: ChangeInventoryCommand): Promise<InventoryDto> {
    const ownerId = PlayerId.create(command.ownerId)
    const itemId = ItemId.create(command.itemId)
    const quantity = Quantity.create(command.quantity)

    const inventory = await this.deps.inventories.findByOwner(ownerId)

    if (inventory === null) {
      throw new InventoryNotFoundError(command.ownerId)
    }

    inventory.remove(itemId, quantity, this.deps.clock.now())

    await this.deps.inventories.save(inventory)
    inventory.pullEvents()

    return toInventoryDto(inventory.toSnapshot())
  }
}
