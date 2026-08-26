import type { Collection, Db } from 'mongodb'

import { Inventory } from '../../../domain/entities/Inventory'
import { PlayerId } from '../../../domain/value-objects/identifiers'
import type { InventoryRepositoryPort } from '../../../application/ports/InventoryRepositoryPort'
import { toDocument, toSnapshot, type InventoryDocument } from './mapping'

/**
 * Repositorio del agregado Inventory sobre MongoDB, con el driver oficial.
 *
 * Cada consulta esta escrita a la vista. No hay una capa que traduzca objetos a
 * documentos por su cuenta, que es la razon por la que ADR-012 eligio el driver
 * y no un ODM: el documento que se guarda es exactamente el que se lee aqui.
 */
export class MongoInventoryRepository implements InventoryRepositoryPort {
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
}
