/**
 * Tokens de inyeccion de los casos de uso.
 *
 * Los casos de uso son clases sin decoradores: no conocen NestJS. Se registran
 * mediante proveedores explicitos en el modulo, y estos simbolos son la unica
 * conexion entre el contenedor y la capa de aplicacion.
 */
export const GET_INVENTORY = Symbol('GetInventory')
export const ADD_ITEM = Symbol('AddItemToInventory')
export const REMOVE_ITEM = Symbol('RemoveItemFromInventory')
export const LIST_OWNED_ITEMS = Symbol('ListOwnedInventoryItems')
export const GET_ITEM_DETAIL = Symbol('GetOwnedInventoryItemDetail')
