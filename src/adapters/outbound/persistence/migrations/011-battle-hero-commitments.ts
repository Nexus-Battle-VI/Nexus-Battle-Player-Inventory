import type { Db } from 'mongodb'

/**
 * Compromisos de batalla (HU-29, contrato `hu-29-battle-commitment-v1`).
 *
 * `_id` es el `operationId` del llamador: la idempotencia la impone el motor y no
 * una lectura previa, que bajo concurrencia mentiria.
 *
 * EL INDICE PARCIAL ES LA INVARIANTE. `{playerId, heroId}` unico **solo** sobre
 * los `ACTIVE` impide que un heroe este en dos batallas a la vez, y deja de
 * cubrirlo en cuanto el compromiso se libera, de modo que el heroe puede volver a
 * comprometerse. Por eso no hace falta una coleccion de exclusion aparte.
 */
export const up = async (db: Db): Promise<void> => {
  await db.createCollection('battle-hero-commitments', {
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
          commitmentId: { bsonType: 'string', minLength: 1 },
          status: { enum: ['ACTIVE', 'RELEASED'] },
        },
      },
    },
  })

  await db.collection('battle-hero-commitments').createIndex({ commitmentId: 1 }, { unique: true })

  // Un heroe, una batalla activa. El filtro parcial es lo que permite volver a
  // comprometerlo despues de liberar.
  await db
    .collection('battle-hero-commitments')
    .createIndex(
      { playerId: 1, heroId: 1 },
      { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
    )

  // La consulta del guard: «¿tiene este heroe un compromiso vigente?».
  await db
    .collection('battle-hero-commitments')
    .createIndex({ playerId: 1, heroId: 1, status: 1, expiresAt: 1 })
}
