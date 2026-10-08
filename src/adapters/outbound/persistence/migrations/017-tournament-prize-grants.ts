import type { Db } from 'mongodb'

/** Reserva de Chat 04 en acuerdo-integracion; no modifica migraciones publicadas. */
export const up = async (db: Db): Promise<void> => {
  const text = (maxLength: number) => ({ bsonType: 'string', minLength: 1, maxLength })
  await db.createCollection('tournament_prize_grants', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: ['_id', 'fingerprint', 'receipt', 'grantedAt'],
        properties: {
          _id: text(512),
          fingerprint: text(8192),
          grantedAt: { bsonType: 'date' },
          receipt: {
            bsonType: 'object',
            additionalProperties: false,
            required: [
              'operationId',
              'tournamentId',
              'championTeamId',
              'finalEncounterId',
              'finalRoomId',
              'playerId',
              'heroId',
              'kind',
              'amount',
              'productId',
              'status',
              'receiptId',
            ],
            properties: {
              operationId: text(512),
              tournamentId: text(160),
              championTeamId: text(160),
              finalEncounterId: text(512),
              finalRoomId: text(160),
              playerId: text(160),
              heroId: text(160),
              kind: { enum: ['EPIC'] },
              amount: { bsonType: 'null' },
              productId: text(160),
              status: { enum: ['DELIVERED'] },
              receiptId: text(160),
            },
          },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })
  // _id es el operationId unico; receiptId tambien es unico en el motor.
  await db
    .collection('tournament_prize_grants')
    .createIndex(
      { 'receipt.receiptId': 1 },
      { name: 'tournament_prize_receipt_unique', unique: true },
    )
}
