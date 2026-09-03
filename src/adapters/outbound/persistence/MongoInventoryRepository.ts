import type { Collection, Db } from 'mongodb'

import { Inventory } from '../../../domain/entities/Inventory'
import { PlayerId } from '../../../domain/value-objects/identifiers'
import type { InventoryRepositoryPort } from '../../../application/ports/InventoryRepositoryPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../../application/ports/InventoryQueryPort'
import { toDocument, toSnapshot, type InventoryDocument, type SlotDocument } from './mapping'

/**
 * Repositorio del agregado Inventory sobre MongoDB, con el driver oficial.
 *
 * Cada consulta esta escrita a la vista. No hay una capa que traduzca objetos a
 * documentos por su cuenta, que es la razon por la que ADR-012 eligio el driver
 * y no un ODM: el documento que se guarda es exactamente el que se lee aqui.
 */
export class MongoInventoryRepository implements InventoryRepositoryPort, InventoryQueryPort {
  private readonly inventories: Collection<InventoryDocument>

  constructor(db: Db) {
    this.inventories = db.collection<InventoryDocument>('inventories')
  }

  /**
   * Guarda el agregado entero.
   *
   * `replaceOne` con `upsert` y no operadores de array como `$push` o `$set`
   * sobre una ranura: el agregado es la autoridad sobre TODO su contenido, y una
   * actualizacion parcial dejaria intacto cualquier campo o ranura que el
   * documento tuviera de mas —de una version anterior del servicio, por
   * ejemplo—. Reemplazar el documento completo expresa lo que de verdad ocurre.
   *
   * No hace falta transaccion: el inventario, con sus ranuras embebidas, es un
   * solo documento, y en MongoDB la escritura de un documento ya es atomica. Es
   * la ventaja de haber embebido las ranuras en lugar de separarlas.
   */
  async save(inventory: Inventory): Promise<void> {
    const document = toDocument(inventory.toSnapshot())

    await this.inventories.replaceOne({ _id: document._id }, document, { upsert: true })
  }

  async findByOwner(ownerId: PlayerId): Promise<Inventory | null> {
    const document = await this.inventories.findOne({ _id: ownerId.value })

    if (document === null) {
      return null
    }

    const snapshot = toSnapshot(document)

    return Inventory.restore({
      ownerId: PlayerId.create(snapshot.ownerId),
      capacity: snapshot.capacity,
      slots: snapshot.slots,
    })
  }

  /**
   * Consulta paginada de las ranuras poseidas (HU-27).
   *
   * El motor calcula el total y devuelve SOLO la porcion pedida: no se recupera
   * el inventario entero para descartar la mayor parte despues. Se consulta por
   * `_id`, que ya esta indexado, asi que no hace falta ningun indice nuevo.
   * `$sortArray` garantiza el mismo orden estable por `itemId` que el agregado.
   */
  async listOwnedItems(
    ownerId: PlayerId,
    page: number,
    pageSize: number,
  ): Promise<OwnedInventoryItemsSlice> {
    const skip = (page - 1) * pageSize

    const [projection] = await this.inventories
      .aggregate<{ readonly items: readonly SlotDocument[]; readonly totalItems: number }>([
        { $match: { _id: ownerId.value } },
        {
          $project: {
            _id: 0,
            totalItems: { $size: { $ifNull: ['$slots', []] } },
            items: {
              $slice: [
                { $sortArray: { input: { $ifNull: ['$slots', []] }, sortBy: { itemId: 1 } } },
                skip,
                pageSize,
              ],
            },
          },
        },
      ])
      .toArray()

    if (projection === undefined) {
      return { items: [], totalItems: 0 }
    }

    return {
      items: projection.items.map(toOwnedItem),
      totalItems: projection.totalItems,
    }
  }

  /**
   * Recupera TODAS las ranuras del jugador ordenadas por `itemId`. Es un solo
   * documento acotado por la capacidad del dominio; la busqueda de HU-27 filtra
   * sobre este universo antes de paginar.
   */
  async findAllOwnedItems(ownerId: PlayerId): Promise<readonly OwnedInventoryItem[]> {
    const [projection] = await this.inventories
      .aggregate<{ readonly items: readonly SlotDocument[] }>([
        { $match: { _id: ownerId.value } },
        {
          $project: {
            _id: 0,
            items: { $sortArray: { input: { $ifNull: ['$slots', []] }, sortBy: { itemId: 1 } } },
          },
        },
      ])
      .toArray()

    return projection === undefined ? [] : projection.items.map(toOwnedItem)
  }
}

const toOwnedItem = (slot: SlotDocument): OwnedInventoryItem => ({
  itemId: slot.itemId,
  // El recuento se guarda como Int32; `Number` lo convierte de forma exacta
  // (un int32 siempre cabe) y tambien acepta un numero ya suelto.
  quantity: Number(slot.quantity),
})
