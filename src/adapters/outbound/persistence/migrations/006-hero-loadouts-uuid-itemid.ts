import type { Db } from 'mongodb'

/**
 * Amplia `entries[].itemId` de `hero-loadouts` para aceptar productId UUID,
 * igual que `003-purchase-grants` ya hizo con `inventories`.
 *
 * `ItemId.create` (dominio) siempre acepto kebab-case O UUID -son las dos
 * formas legitimas de una referencia de inventario-, pero el validador
 * `$jsonSchema` de `002-hero-loadouts` solo declaraba el patron kebab-case.
 * Cualquier equipamiento cuyo `itemId` en el inventario del jugador fuera un
 * UUID -que es el caso normal: una compra completada guarda el `productId`
 * como `itemId`, no un slug- pasaba la validacion del dominio y luego
 * `MongoHeroLoadoutRepository.save` fallaba con `MongoServerError: Document
 * failed validation` (codigo 121), no capturado como error de dominio y
 * traducido a un 500 generico.
 */
export const up = async (db: Db): Promise<void> => {
  const EQUIPMENT_SLOTS = [
    'WEAPON_1',
    'WEAPON_2',
    'HELMET',
    'CHEST',
    'GLOVES',
    'BRACERS',
    'PANTS',
    'SHOES',
    'ITEM_1',
    'ITEM_2',
  ]

  await db.command({
    collMod: 'hero-loadouts',
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'ownerId', 'heroId', 'version', 'entries'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          ownerId: { bsonType: 'string', minLength: 1 },
          heroId: { bsonType: 'string', minLength: 1 },
          version: { bsonType: 'int', minimum: 0 },
          entries: {
            bsonType: 'array',
            maxItems: 10,
            items: {
              bsonType: 'object',
              required: ['slot', 'itemId', 'productId'],
              additionalProperties: false,
              properties: {
                slot: { enum: EQUIPMENT_SLOTS },
                itemId: {
                  bsonType: 'string',
                  pattern:
                    '^([a-z][a-z0-9]*(-[a-z0-9]+)*|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$',
                },
                productId: { bsonType: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })
}
