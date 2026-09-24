import type { Db } from 'mongodb'

/** Ledger durable y documento de exclusion por jugador y heroe. No se borran al expirar. */
export const up = async (db: Db): Promise<void> => {
  await db.createCollection('hero-mission-gates', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'revision', 'operationId', 'expiresAt'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          revision: { bsonType: 'int', minimum: 1 },
          operationId: { bsonType: ['string', 'null'] },
          expiresAt: { bsonType: ['date', 'null'] },
        },
      },
    },
  })
  await db.createCollection('mission-hero-commitments', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: [
          '_id',
          'operationId',
          'playerId',
          'heroId',
          'reference',
          'expiresAt',
          'completeLoadout',
          'commitmentId',
          'status',
        ],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          operationId: { bsonType: 'string', minLength: 1 },
          playerId: { bsonType: 'string', minLength: 1 },
          heroId: { bsonType: 'string', minLength: 1 },
          reference: { bsonType: 'string', minLength: 1 },
          expiresAt: { bsonType: 'date' },
          completeLoadout: { bsonType: 'bool' },
          commitmentId: { bsonType: 'string', minLength: 1 },
          status: { enum: ['ACTIVE', 'RELEASED'] },
        },
      },
    },
  })
  await db.collection('mission-hero-commitments').createIndex({ commitmentId: 1 }, { unique: true })
  await db.collection('mission-hero-commitments').createIndex({ playerId: 1, heroId: 1, status: 1 })
}
