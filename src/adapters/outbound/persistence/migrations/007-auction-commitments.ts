import type { Db } from 'mongodb'
export const up = async (db: Db): Promise<void> => {
  await db.createCollection('auction_commitments')
  await db.collection('auction_commitments').createIndex({ commitmentId: 1 }, { unique: true })
  await db.collection('auction_commitments').createIndex({ ownerId: 1, productId: 1, status: 1 })
  await db.createCollection('auction_commitment_operations')
  await db
    .collection('auction_commitment_operations')
    .createIndex({ operationId: 1 }, { unique: true })
}
