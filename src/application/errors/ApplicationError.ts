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
