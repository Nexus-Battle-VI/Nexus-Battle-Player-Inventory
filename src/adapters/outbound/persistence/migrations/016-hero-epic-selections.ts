import type { Db } from 'mongodb'

/**
 * Esquema de la epica equipada de un heroe (HU-31, contrato
 * `hu-31-equipped-epic-v1`).
 *
 * Coleccion PROPIA y SEPARADA de `hero-loadouts` (002-hero-loadouts): esta
 * seleccion no tiene ranuras ni capacidad 2/6/2, y HU-28 excluye `EPICA` de
 * `EquipmentCategory`. Un documento por (jugador, heroe), igual patron de
 * `_id` compuesto que el loadout. `epicItemId`/`epicProductId` viajan juntos
 * o ninguno de los dos: el agregado nunca persiste una pareja incompleta.
 *
 * El validador vive en el MOTOR, mismo criterio que `002-hero-loadouts`.
 *
 * `epicItemId` admite kebab-case O UUID, mismo patron que `006-hero-loadouts-uuid-itemid`
 * ya establecio para `hero-loadouts.entries[].itemId`: `ItemId.create` (dominio) siempre
 * acepto las dos formas -una compra completada guarda el `productId` (UUID) como `itemId`,
 * no un slug-, y un validador que solo declare kebab-case rechaza esos documentos con
 * `MongoServerError: Document failed validation` (codigo 121) en vez de un error de dominio.
 */
export const up = async (db: Db): Promise<void> => {
  await db.createCollection('hero-epic-selections', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'ownerId', 'heroId', 'version', 'epicItemId', 'epicProductId'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          ownerId: { bsonType: 'string', minLength: 1 },
          heroId: { bsonType: 'string', minLength: 1 },
          // Version del bloqueo optimista. `int` y no `double`.
          version: { bsonType: 'int', minimum: 0 },
          epicItemId: {
            bsonType: ['string', 'null'],
            pattern:
              '^([a-z][a-z0-9]*(-[a-z0-9]+)*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$',
          },
          epicProductId: { bsonType: ['string', 'null'], minLength: 1 },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })
}

export const down = async (db: Db): Promise<void> => {
  await db.collection('hero-epic-selections').drop()
}
