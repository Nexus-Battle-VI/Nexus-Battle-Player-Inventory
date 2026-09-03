import type { PlayerId } from '../../domain/value-objects/identifiers'

/**
 * Una ranura del inventario proyectada para la consulta paginada de HU-27.
 *
 * Contiene solo lo que Player/Inventory posee como fuente de verdad: el
 * identificador del objeto y la cantidad. El nombre, la imagen, la descripcion o
 * la calificacion del producto pertenecen a otros contextos (Catalog, Community)
 * y no se resuelven aqui.
 */
export interface OwnedInventoryItem {
  readonly itemId: string
  readonly quantity: number
}

/**
 * Porcion del inventario que un puerto de consulta devuelve: la pagina pedida de
 * ranuras y el total real, sin materializar el resto de las ranuras.
 */
export interface OwnedInventoryItemsSlice {
  readonly items: readonly OwnedInventoryItem[]
  readonly totalItems: number
}

/**
 * Puerto de LECTURA del inventario (CQRS ligero).
 *
 * Se separa de `InventoryRepositoryPort` a proposito. Aquel reconstituye el
 * agregado completo para aplicar comandos y proteger sus invariantes; este
 * resuelve la consulta paginada de HU-27 sobre las ranuras poseidas sin
 * recuperar el inventario entero para descartar la mayor parte despues
 * (TASK HU-27.2).
 *
 * Ambos adaptadores de persistencia lo implementan sobre el mismo almacen que
 * `InventoryRepositoryPort`: la separacion es de responsabilidad, no de origen
 * de datos.
 */
export interface InventoryQueryPort {
  /**
   * Devuelve la pagina `page` (1-based) de `pageSize` ranuras del jugador,
   * ordenadas de forma estable por `itemId`, junto al total real de ranuras.
   *
   * Un jugador sin documento de inventario se comporta como un inventario
   * vacio: `items` vacio y `totalItems` cero. Una pagina valida mas alla del
   * total devuelve `items` vacio sin alterar `totalItems`.
   */
  listOwnedItems(
    ownerId: PlayerId,
    page: number,
    pageSize: number,
  ): Promise<OwnedInventoryItemsSlice>

  /**
   * Devuelve TODAS las ranuras del jugador, ordenadas de forma estable por
   * `itemId`. Es el universo sobre el que la busqueda de HU-27 filtra antes de
   * paginar: el total y las paginas de una busqueda se calculan sobre el
   * resultado filtrado, no sobre el inventario entero.
   *
   * El agregado esta acotado por el dominio (capacidad maxima 200 ranuras), asi
   * que recuperar el conjunto completo es un unico documento pequeno.
   */
  findAllOwnedItems(ownerId: PlayerId): Promise<readonly OwnedInventoryItem[]>
}

export const INVENTORY_QUERY = Symbol('InventoryQueryPort')
