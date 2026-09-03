/**
 * Errores de la capa de aplicacion. Describen el resultado del caso de uso sin
 * conocer el protocolo: la traduccion a HTTP ocurre en el adaptador de entrada.
 */
export class InventoryNotFoundError extends Error {
  constructor(ownerId: string) {
    super(`El jugador "${ownerId}" no tiene un inventario registrado.`)
    this.name = 'InventoryNotFoundError'
  }
}

/**
 * El jugador no posee esa referencia, o Catalog no conoce el producto que
 * posee. Se traduce a 404 en ambos casos: distinguirlos filtraria si el
 * producto existe en el catalogo de otra persona.
 */
export class InventoryItemNotFoundError extends Error {
  constructor(itemReference: string) {
    super(`El jugador no posee el producto "${itemReference}".`)
    this.name = 'InventoryItemNotFoundError'
  }
}

/**
 * El heroe no pertenece al jugador autenticado, no existe, o la referencia no
 * corresponde a un producto de tipo HEROE. Se traduce a 404 en todos los casos
 * por la misma politica anti-enumeracion que el resto del servicio: distinguir
 * los casos revelaria que ese heroe existe en el inventario de otra persona.
 */
export class HeroNotOwnedError extends Error {
  constructor(heroReference: string) {
    super(`El jugador no dispone del heroe "${heroReference}".`)
    this.name = 'HeroNotOwnedError'
  }
}

/**
 * El producto a equipar no esta en el inventario del jugador, o Catalog no lo
 * conoce. 404 por anti-enumeracion, igual que la ficha de HU-27.
 */
export class EquipmentProductNotOwnedError extends Error {
  constructor(productReference: string) {
    super(`El jugador no posee el producto "${productReference}".`)
    this.name = 'EquipmentProductNotOwnedError'
  }
}

/**
 * La referencia SI es un producto poseido, pero su tipo canonico no es
 * equipable en HU-28 (no es ARMA, ARMADURA ni ITEM). Es un dato valido con una
 * regla incumplida: 422.
 */
export class InvalidEquipmentTypeError extends Error {
  constructor(productReference: string, productType: string) {
    super(
      `El producto "${productReference}" es de tipo ${productType} y no se puede equipar en un heroe.`,
    )
    this.name = 'InvalidEquipmentTypeError'
  }
}

/**
 * El producto es una pieza de armadura, pero su ranura canonica no coincide con
 * la ranura solicitada (p. ej. un peto en la ranura del casco). 422.
 */
export class EquipmentSlotMismatchError extends Error {
  constructor(slot: string, expectedArmorSlot: string, actualArmorSlot: string | null) {
    super(
      `La ranura ${slot} espera una pieza de tipo ${expectedArmorSlot}; el producto es de tipo ${actualArmorSlot ?? 'desconocido'}.`,
    )
    this.name = 'EquipmentSlotMismatchError'
  }
}

/**
 * Otra escritura modifico el loadout entre la lectura y el guardado (bloqueo
 * optimista). 409: la peticion es correcta y puede reintentarse.
 */
export class HeroLoadoutConflictError extends Error {
  constructor(heroId: string) {
    super(`El equipamiento del heroe ${heroId} cambio durante la operacion. Reintentelo.`)
    this.name = 'HeroLoadoutConflictError'
  }
}
