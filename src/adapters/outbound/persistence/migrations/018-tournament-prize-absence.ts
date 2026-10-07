import type { Db } from 'mongodb'
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
/** Amplía solo finalRoomId: conserva recibos, índices y las demás invariantes de 017. */
export const up = async (db: Db): Promise<void> => {
  const collection = await db
    .listCollections({ name: 'tournament_prize_grants' }, { nameOnly: false })
    .next()
  const validator: unknown = collection?.options?.validator
  if (!record(validator) || !record(validator.$jsonSchema))
    throw new Error('Falta el esquema de premios 017.')
  const schema = validator.$jsonSchema
  if (!record(schema.properties) || !record(schema.properties.receipt))
    throw new Error('Falta el recibo de premios 017.')
  const receipt = schema.properties.receipt
  if (!record(receipt.properties) || !record(receipt.properties.finalRoomId))
    throw new Error('Falta finalRoomId de premios 017.')
  await db.command({
    collMod: 'tournament_prize_grants',
    validator: {
      ...validator,
      $jsonSchema: {
        ...schema,
        properties: {
          ...schema.properties,
          receipt: {
            ...receipt,
            properties: {
              ...receipt.properties,
              finalRoomId: { ...receipt.properties.finalRoomId, bsonType: ['string', 'null'] },
            },
          },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })
}
