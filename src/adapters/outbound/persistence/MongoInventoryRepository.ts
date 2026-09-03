import { Int32, MongoServerError, type Collection, type Db } from 'mongodb'

import { Inventory } from '../../../domain/entities/Inventory'
import { ItemId, PlayerId, Quantity } from '../../../domain/value-objects/identifiers'
import { CapacityPolicy } from '../../../domain/policies/CapacityPolicy'
import {
  InventoryConcurrentWriteError,
  InventoryGrantConflictError,
  InventoryGrantRejectedError,
  type InventoryGrantCommand,
  type InventoryGrantPort,
  type InventoryGrantResult,
} from '../../../application/ports/InventoryGrantPort'
import { DomainError } from '../../../domain/errors/DomainError'
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
interface GrantDocument {
  readonly _id: string
  readonly fingerprint: string
  readonly result: InventoryGrantResult | null
  readonly rejection: string | null
  readonly createdAt: Date
}

export class MongoInventoryRepository
  implements InventoryRepositoryPort, InventoryQueryPort, InventoryGrantPort
{
  private readonly inventories: Collection<InventoryDocument>
  private readonly grants: Collection<GrantDocument>
  private readonly revisions = new WeakMap<Inventory, number>()

  constructor(private readonly db: Db) {
    this.inventories = db.collection<InventoryDocument>('inventories')
    this.grants = db.collection<GrantDocument>('inventory_grants')
  }

  /**
   * Guarda el agregado entero.
   *
   * `replaceOne` condicionado a la revision leida, sin `upsert` ni operadores de array como `$push` o `$set`
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
    const revision = this.revisions.get(inventory)
    if (revision === undefined) {
      try {
        await this.inventories.insertOne({ ...document, revision: new Int32(1) })
      } catch (error: unknown) {
        if (error instanceof MongoServerError && error.code === 11000)
          throw new InventoryConcurrentWriteError()
        throw error
      }
      this.revisions.set(inventory, 1)
      return
    }
    const updated = await this.inventories.replaceOne(
      { _id: document._id, ...revisionFilter(revision) },
      { ...document, revision: new Int32(revision + 1) },
    )
    if (updated.matchedCount !== 1) throw new InventoryConcurrentWriteError()
    this.revisions.set(inventory, revision + 1)
  }

  async findByOwner(ownerId: PlayerId): Promise<Inventory | null> {
    const document = await this.inventories.findOne({ _id: ownerId.value })

    if (document === null) {
      return null
    }

    const snapshot = toSnapshot(document)

    const inventory = Inventory.restore({
      ownerId: PlayerId.create(snapshot.ownerId),
      capacity: snapshot.capacity,
      slots: snapshot.slots,
    })
    this.revisions.set(inventory, Number(document.revision ?? 0))
    return inventory
  }

  async grant(command: InventoryGrantCommand): Promise<InventoryGrantResult> {
    const fingerprint = JSON.stringify({ playerId: command.playerId, items: command.items })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const outcome = await this.db.client.withSession(async (session) =>
          session.withTransaction(
            async () => {
              const previous = await this.grants.findOne({ _id: command.operationId }, { session })
              if (previous !== null) {
                if (previous.fingerprint !== fingerprint) throw new InventoryGrantConflictError()
                if (previous.rejection !== null) return previous.rejection
                if (previous.result === null) throw new Error('Resultado de entrega incompleto.')
                return previous.result
              }
              const document = await this.inventories.findOne(
                { _id: command.playerId },
                { session },
              )
              const ownerId = PlayerId.create(command.playerId)
              const snapshot = document === null ? null : toSnapshot(document)
              const inventory =
                snapshot === null
                  ? Inventory.createEmpty(ownerId, CapacityPolicy.default())
                  : Inventory.restore({
                      ownerId,
                      capacity: snapshot.capacity,
                      slots: snapshot.slots,
                    })
              try {
                for (const item of command.items) {
                  inventory.add(
                    ItemId.create(item.productId),
                    Quantity.create(item.quantity),
                    new Date(),
                  )
                }
              } catch (error: unknown) {
                if (!(error instanceof DomainError)) throw error
                await this.grants.insertOne(
                  {
                    _id: command.operationId,
                    fingerprint,
                    result: null,
                    rejection: error.message,
                    createdAt: new Date(),
                  },
                  { session },
                )
                return error.message
              }
              const revision = Number(document?.revision ?? 0)
              const next = {
                ...toDocument(inventory.toSnapshot()),
                revision: new Int32(revision + 1),
              }
              if (document === null) {
                await this.inventories.insertOne(next, { session })
              } else {
                const saved = await this.inventories.replaceOne(
                  { _id: command.playerId, ...revisionFilter(revision) },
                  next,
                  { session },
                )
                if (saved.matchedCount !== 1) throw new InventoryConcurrentWriteError()
              }
              const result: InventoryGrantResult = { ...command, applied: true }
              await this.grants.insertOne(
                {
                  _id: command.operationId,
                  fingerprint,
                  result,
                  rejection: null,
                  createdAt: new Date(),
                },
                { session },
              )
              return result
            },
            { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
          ),
        )
        if (typeof outcome === 'string') throw new InventoryGrantRejectedError(outcome)
        return outcome
      } catch (error: unknown) {
        // Una creacion concurrente de inventario/operacion puede colisionar antes
        // de que Mongo la clasifique como WriteConflict. Volver a leer es seguro.
        if (!(error instanceof MongoServerError && error.code === 11000) || attempt === 2)
          throw error
      }
    }
    throw new InventoryConcurrentWriteError()
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

const revisionFilter = (revision: number) =>
  revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision }
