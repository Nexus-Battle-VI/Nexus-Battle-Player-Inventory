import type { Db } from 'mongodb'

/** Amplia la lectura de referencias legacy con productId UUID y version CAS. */
export const up = async (db: Db): Promise<void> => {
  await db.command({
    collMod: 'inventories',
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'capacity', 'slots'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          capacity: { bsonType: 'int', minimum: 1, maximum: 200 },
          revision: { bsonType: 'int', minimum: 0 },
          slots: {
            bsonType: 'array',
            maxItems: 200,
            items: {
              bsonType: 'object',
              required: ['itemId', 'quantity'],
              additionalProperties: false,
              properties: {
                itemId: {
                  bsonType: 'string',
                  pattern:
                    '^([a-z][a-z0-9]*(-[a-z0-9]+)*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$',
                },
                quantity: { bsonType: 'int', minimum: 1, maximum: 9999 },
              },
            },
          },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })
  await db.createCollection('inventory_grants', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'fingerprint', 'result', 'rejection', 'createdAt'],
        properties: {
          _id: { bsonType: 'string' },
          fingerprint: { bsonType: 'string' },
          result: { bsonType: ['object', 'null'] },
          rejection: { bsonType: ['string', 'null'] },
          createdAt: { bsonType: 'date' },
        },
      },
    },
  })
}
