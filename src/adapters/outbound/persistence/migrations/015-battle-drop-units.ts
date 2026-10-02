import type { Db } from 'mongodb'

/** Identidades de unidades equipadas y ledger de traslados HU-30. */
export const up = async (db: Db): Promise<void> => {
  await db.createCollection('battle-drop-units', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'itemId', 'productId', 'ownerId', 'battleId', 'heroId', 'slot'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          itemId: { bsonType: 'string', minLength: 1 },
          productId: { bsonType: 'string', minLength: 1 },
          ownerId: { bsonType: 'string', minLength: 1 },
          battleId: { bsonType: 'string' },
          heroId: { bsonType: 'string' },
          slot: { bsonType: 'string' },
        },
      },
    },
  })
  await db.collection('battle-drop-units').createIndex({ ownerId: 1, itemId: 1 })
  await db
    .collection('battle-drop-units')
    .createIndex(
      { battleId: 1, ownerId: 1, heroId: 1, slot: 1 },
      { unique: true, partialFilterExpression: { battleId: { $gt: '' } } },
    )

  await db.createCollection('battle-drop-snapshots', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'fingerprint', 'snapshot'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          fingerprint: { bsonType: 'string', minLength: 1 },
          snapshot: { bsonType: 'object' },
        },
      },
    },
  })

  await db.createCollection('battle-drop-transfers', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'fingerprint', 'result'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          fingerprint: { bsonType: 'string', minLength: 1 },
          result: { bsonType: 'object' },
        },
      },
    },
  })
}

export const down = async (db: Db): Promise<void> => {
  await db.collection('battle-drop-transfers').drop()
  await db.collection('battle-drop-snapshots').drop()
  await db.collection('battle-drop-units').drop()
}
