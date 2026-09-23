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
export const GET_HERO_EQUIPMENT = Symbol('GetHeroEquipment')
export const EQUIP_ITEM_ON_HERO = Symbol('EquipItemOnHero')
export const LIST_AVAILABLE_HEROES = Symbol('ListAvailableHeroes')
export const GET_HERO_SELECTION = Symbol('GetHeroSelection')
export const SELECT_HERO = Symbol('SelectHero')
export const GET_EQUIPPED_HERO_FOR_COMBAT = Symbol('GetEquippedHeroForCombat')
export const GET_HERO_PROGRESSION = Symbol('GetHeroProgression')

/**
 * Operacion reutilizable de consulta del umbral (HU-08). Es el punto por el que
 * HU-09 y HU-10 piden el umbral sin conocer la tabla, y no tiene controlador: se
 * registra para que otros casos de uso de este servicio puedan depender de ella
 * en lugar de reimplementar los ocho valores de la aclaracion.
 */
export const QUERY_EXPERIENCE_THRESHOLD = Symbol('QueryExperienceThreshold')
