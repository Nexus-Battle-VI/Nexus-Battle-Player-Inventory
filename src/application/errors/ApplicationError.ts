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
