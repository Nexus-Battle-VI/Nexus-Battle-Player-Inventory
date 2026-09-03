import { DomainError } from '../errors/DomainError'
import type { DomainEvent } from '../events/DomainEvent'
import { heroItemEquipped } from '../events/HeroLoadoutEvents'
import {
  ALL_EQUIPMENT_SLOTS,
  categoryOfSlot,
  EQUIPMENT_CAPACITY,
  slotsOfCategory,
  type EquipmentCategory,
  type EquipmentSlot,
} from '../value-objects/equipment'
import { ItemId } from '../value-objects/identifiers'

/**
 * Ranura ocupada del equipamiento de un heroe.
 *
 * `itemId` es la referencia del inventario (kebab-case, la misma que Catalog
 * publica como alias `sku`) y es lo que ata la pieza a la pertenencia del
 * jugador. `productId` es la identidad canonica (UUID) del producto en Catalog.
 */
export interface HeroLoadoutEntrySnapshot {
  readonly slot: EquipmentSlot
  readonly itemId: string
  readonly productId: string
}

export interface HeroLoadoutSnapshot {
  readonly ownerId: string
  readonly heroId: string
  readonly version: number
  readonly entries: readonly HeroLoadoutEntrySnapshot[]
}

/**
 * El heroe ya tiene ocupada esa ranura exacta. HU-28 NO reemplaza en silencio:
 * la regla de sustitucion se define en HU-28.3 y aun no existe (TASK HU-28.3).
 */
export class EquipmentSlotOccupiedError extends DomainError {
  constructor(slot: string, occupiedBy: string) {
    super(`La ranura ${slot} ya esta ocupada por el producto ${occupiedBy}.`)
    this.name = 'EquipmentSlotOccupiedError'
  }
}

/** El mismo objeto del inventario ya esta montado en otra ranura del heroe. */
export class ItemAlreadyEquippedError extends DomainError {
  constructor(itemId: string, slot: string) {
    super(`El objeto "${itemId}" ya esta equipado en la ranura ${slot}.`)
    this.name = 'ItemAlreadyEquippedError'
  }
}

/** El tipo del producto no corresponde a la familia de la ranura pedida. */
export class InvalidEquipmentSlotError extends DomainError {
  constructor(slot: string, category: string) {
    super(`La ranura ${slot} no admite un producto de la familia ${category}.`)
    this.name = 'InvalidEquipmentSlotError'
  }
}

export class WeaponCapacityExceededError extends DomainError {
  constructor() {
    super('Un heroe no puede llevar mas de 2 armas equipadas.')
    this.name = 'WeaponCapacityExceededError'
  }
}

export class ArmorCapacityExceededError extends DomainError {
  constructor() {
    super('Un heroe no puede llevar mas de 6 piezas de armadura equipadas.')
    this.name = 'ArmorCapacityExceededError'
  }
}

export class ItemCapacityExceededError extends DomainError {
  constructor() {
    super('Un heroe no puede llevar mas de 2 items equipados.')
    this.name = 'ItemCapacityExceededError'
  }
}

const capacityError = (category: EquipmentCategory): DomainError => {
  if (category === 'WEAPON') return new WeaponCapacityExceededError()
  if (category === 'ARMOR') return new ArmorCapacityExceededError()
  return new ItemCapacityExceededError()
}

/**
 * Raiz de agregado del equipamiento de un heroe (RF-28).
 *
 * Un loadout son las ranuras ocupadas de UN heroe de UN jugador. El agregado es
 * la autoridad sobre las capacidades 2/6/2, sobre "una pieza por ranura exacta"
 * y sobre que no se reemplace nada en silencio. La pertenencia del heroe y del
 * producto al jugador se comprueba antes, en la capa de aplicacion, porque
 * depende de servicios externos; el agregado no confia en el exterior y vuelve
 * a validar la coherencia ranura/familia que si conoce.
 *
 * `version` habilita el bloqueo optimista del repositorio: dos peticiones
 * simultaneas no pueden romper el limite 2/6/2 porque la segunda escritura
 * chocara de version.
 */
export class HeroLoadout {
  readonly ownerId: string
  readonly heroId: string
  private readonly _version: number
  private readonly slots: Map<EquipmentSlot, HeroLoadoutEntrySnapshot>
  private readonly events: DomainEvent[] = []

  private constructor(
    ownerId: string,
    heroId: string,
    version: number,
    slots: Map<EquipmentSlot, HeroLoadoutEntrySnapshot>,
  ) {
    this.ownerId = ownerId
    this.heroId = heroId
    this._version = version
    this.slots = slots
  }

  static createEmpty(ownerId: string, heroId: string): HeroLoadout {
    return new HeroLoadout(ownerId, heroId, 0, new Map())
  }

  /** Reconstituye un loadout persistido. No emite eventos. */
  static restore(snapshot: HeroLoadoutSnapshot): HeroLoadout {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 0) {
      throw new DomainError('La version restaurada del loadout debe ser un entero no negativo.')
    }

    const slots = new Map<EquipmentSlot, HeroLoadoutEntrySnapshot>()
    const seenItems = new Set<string>()

    for (const entry of snapshot.entries) {
      if (!(ALL_EQUIPMENT_SLOTS as readonly string[]).includes(entry.slot)) {
        throw new DomainError(`El loadout restaurado usa una ranura desconocida: "${entry.slot}".`)
      }
      if (slots.has(entry.slot)) {
        throw new DomainError(`El loadout restaurado repite la ranura "${entry.slot}".`)
      }
      const itemId = ItemId.create(entry.itemId).value
      if (seenItems.has(itemId)) {
        throw new DomainError(`El loadout restaurado repite el objeto "${itemId}".`)
      }
      seenItems.add(itemId)
      slots.set(entry.slot, { slot: entry.slot, itemId, productId: entry.productId })
    }

    return new HeroLoadout(snapshot.ownerId, snapshot.heroId, snapshot.version, slots)
  }

  get version(): number {
    return this._version
  }

  entry(slot: EquipmentSlot): HeroLoadoutEntrySnapshot | undefined {
    return this.slots.get(slot)
  }

  isEmpty(): boolean {
    return this.slots.size === 0
  }

  filledCount(category: EquipmentCategory): number {
    return slotsOfCategory(category).reduce(
      (total, slot) => total + (this.slots.has(slot) ? 1 : 0),
      0,
    )
  }

  pullEvents(): readonly DomainEvent[] {
    return this.events.splice(0, this.events.length)
  }

  /**
   * Equipa un producto en una ranura EXACTA.
   *
   * Precondiciones que ya comprobo la capa de aplicacion: el heroe y el
   * producto pertenecen al jugador, el producto existe en Catalog y su `slot`
   * canonico —si es armadura— casa con la ranura. El agregado vuelve a exigir
   * la coherencia ranura/familia y aplica las capacidades y la regla de "sin
   * reemplazo silencioso".
   */
  equip(params: {
    readonly slot: EquipmentSlot
    readonly itemId: string
    readonly productId: string
    readonly category: EquipmentCategory
    readonly occurredAt: Date
  }): void {
    const { slot, category } = params
    const itemId = ItemId.create(params.itemId).value

    if (categoryOfSlot(slot) !== category) {
      throw new InvalidEquipmentSlotError(slot, category)
    }

    const occupying = this.slots.get(slot)
    if (occupying !== undefined) {
      throw new EquipmentSlotOccupiedError(slot, occupying.productId)
    }

    for (const [existingSlot, entry] of this.slots) {
      if (entry.itemId === itemId) {
        throw new ItemAlreadyEquippedError(itemId, existingSlot)
      }
    }

    // Defensa en profundidad: con ranuras explicitas y exactamente N por
    // familia esto no deberia dispararse, pero deja el limite 2/6/2 afirmado en
    // el agregado y no solo implicito en el numero de ranuras.
    if (this.filledCount(category) >= EQUIPMENT_CAPACITY[category]) {
      throw capacityError(category)
    }

    this.slots.set(slot, { slot, itemId, productId: params.productId })
    this.events.push(
      heroItemEquipped({
        aggregateId: `${this.ownerId}:${this.heroId}`,
        heroId: this.heroId,
        slot,
        itemId,
        productId: params.productId,
        occurredAt: params.occurredAt,
      }),
    )
  }

  toSnapshot(): HeroLoadoutSnapshot {
    return {
      ownerId: this.ownerId,
      heroId: this.heroId,
      version: this._version,
      entries: ALL_EQUIPMENT_SLOTS.flatMap((slot) => {
        const entry = this.slots.get(slot)
        return entry === undefined ? [] : [entry]
      }),
    }
  }
}
