import { randomUUID } from 'node:crypto'
import { Int32, MongoServerError, type ClientSession, type Collection, type Db } from 'mongodb'
import { Inventory } from '../../../domain/entities/Inventory'
import { DomainError } from '../../../domain/errors/DomainError'
import { ItemId, PlayerId, Quantity } from '../../../domain/value-objects/identifiers'
import {
  TournamentPrizeError,
  tournamentPrizeFingerprint,
  type TournamentPrizeCommand,
  type TournamentPrizePort,
  type TournamentPrizeReceipt,
} from '../../../application/ports/TournamentPrizePort'
import { toDocument, toSnapshot, type InventoryDocument } from './mapping'

interface OperationDocument {
  readonly _id: string
  readonly fingerprint: string
  readonly result: null
  readonly rejection: null
  readonly createdAt: Date
}
interface PrizeDocument {
  readonly _id: string
  readonly fingerprint: string
  readonly receipt: TournamentPrizeReceipt
  readonly grantedAt: Date
}

/** Tres documentos en una transaccion majority; nunca escribe en una base ajena. */
export class MongoTournamentPrizeRepository implements TournamentPrizePort {
  private readonly operations: Collection<OperationDocument>
  private readonly prizes: Collection<PrizeDocument>
  private readonly inventories: Collection<InventoryDocument>

  constructor(private readonly db: Db) {
    this.operations = db.collection<OperationDocument>('inventory_grants')
    this.prizes = db.collection<PrizeDocument>('tournament_prize_grants')
    this.inventories = db.collection<InventoryDocument>('inventories')
  }

  async find(command: TournamentPrizeCommand): Promise<TournamentPrizeReceipt | null> {
    return this.previous(command)
  }

  private async previous(
    command: TournamentPrizeCommand,
    session?: ClientSession,
  ): Promise<TournamentPrizeReceipt | null> {
    const options = {
      session,
      readConcern: session === undefined ? { level: 'majority' as const } : undefined,
    }
    const operation = await this.operations.findOne({ _id: command.operationId }, options)
    if (operation === null) return null
    const fingerprint = tournamentPrizeFingerprint(command)
    if (operation.fingerprint !== fingerprint)
      throw new TournamentPrizeError(
        'OPERATION_ID_REUSED',
        409,
        'El operationId ya fue usado con otro derecho o proposito.',
      )
    const prize = await this.prizes.findOne({ _id: command.operationId }, options)
    if (
      prize?.fingerprint !== fingerprint ||
      tournamentPrizeFingerprint(prize.receipt) !== fingerprint ||
      !prize.receipt.receiptId
    ) {
      throw new TournamentPrizeError(
        'PRIZE_DEPENDENCY_UNAVAILABLE',
        503,
        'El registro durable del premio requiere revision; conserve el mismo operationId.',
      )
    }
    return prize.receipt
  }

  async grant(
    command: TournamentPrizeCommand,
    ownedHeroItemId: string,
  ): Promise<TournamentPrizeReceipt> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.db.client.withSession(async (session) =>
          session.withTransaction(
            async () => {
              const previous = await this.previous(command, session)
              if (previous !== null) return previous
              const document = await this.inventories.findOne(
                { _id: command.playerId },
                { session },
              )
              if (
                !document?.slots.some(
                  (slot) => slot.itemId === ownedHeroItemId && Number(slot.quantity) > 0,
                )
              ) {
                throw new TournamentPrizeError(
                  'PRIZE_INVALID',
                  422,
                  'El heroe ya no pertenece al destinatario al confirmar el premio.',
                )
              }
              const snapshot = toSnapshot(document)
              const inventory = Inventory.restore({
                ownerId: PlayerId.create(snapshot.ownerId),
                capacity: snapshot.capacity,
                slots: snapshot.slots,
              })
              const grantedAt = new Date()
              try {
                inventory.add(ItemId.create(command.productId), Quantity.create(1), grantedAt)
              } catch (error: unknown) {
                if (!(error instanceof DomainError)) throw error
                throw new TournamentPrizeError(
                  'PRIZE_INVALID',
                  422,
                  'El inventario no admite la unidad de premio; libere capacidad y reintente el mismo derecho.',
                )
              }
              const fingerprint = tournamentPrizeFingerprint(command)
              const receipt: TournamentPrizeReceipt = {
                ...command,
                status: 'DELIVERED',
                receiptId: randomUUID(),
              }
              // Registro COMPARTIDO con compras, cofres y misiones. Su _id evita
              // reutilizar el identificador con otro proposito en esas capacidades.
              await this.operations.insertOne(
                {
                  _id: command.operationId,
                  fingerprint,
                  result: null,
                  rejection: null,
                  createdAt: grantedAt,
                },
                { session },
              )
              const revision = Number(document.revision ?? 0)
              const revisionQuery =
                revision === 0
                  ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
                  : { revision }
              const written = await this.inventories.replaceOne(
                { _id: command.playerId, ...revisionQuery },
                { ...toDocument(inventory.toSnapshot()), revision: new Int32(revision + 1) },
                { session },
              )
              if (written.matchedCount !== 1)
                throw new TournamentPrizeError(
                  'PRIZE_DEPENDENCY_UNAVAILABLE',
                  503,
                  'El inventario cambio. Reintente el mismo derecho.',
                )
              await this.prizes.insertOne(
                { _id: command.operationId, fingerprint, receipt, grantedAt },
                { session },
              )
              return receipt
            },
            { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
          ),
        )
      } catch (error: unknown) {
        // El driver reintenta WriteConflict/commit desconocido; una carrera de
        // insercion _id puede ser 11000 y requiere volver a leer el recibo.
        if (!(error instanceof MongoServerError && error.code === 11000) || attempt === 3)
          throw error
      }
    }
    throw new TournamentPrizeError(
      'PRIZE_DEPENDENCY_UNAVAILABLE',
      503,
      'No se pudo confirmar el premio.',
    )
  }
}
