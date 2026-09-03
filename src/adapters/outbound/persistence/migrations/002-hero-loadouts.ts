import type { Db } from 'mongodb'

/**
 * Esquema del equipamiento de heroe (HU-28, RF-28).
 *
 * Coleccion propia de Player/Inventory: la fuente de verdad del loadout vive
 * aqui y ningun otro servicio la lee. Un documento por (jugador, heroe), con las
 * entradas embebidas, de modo que equipar es una unica escritura atomica.
 *
 * El validador vive en el MOTOR, igual que `001-inventories`: es el equivalente
 * de las restricciones `CHECK` de un motor relacional, no una segunda
 * comprobacion en la aplicacion. Hay invariantes que `$jsonSchema` no expresa
 * —que no se repita una ranura ni un objeto entre entradas, y los limites
 * 2/6/2— y que aplica el agregado y comprueba la traduccion al leer; hay
 * pruebas para ambas cosas.
 *
 * `up` recibe `Db` a proposito: una migracion queda congelada y debe seguir
 * siendo ejecutable tal como se escribio.
 */
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

export const up = async (db: Db): Promise<void> => {
  await db.createCollection('hero-loadouts', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'ownerId', 'heroId', 'version', 'entries'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          ownerId: { bsonType: 'string', minLength: 1 },
          heroId: { bsonType: 'string', minLength: 1 },
          // Version del bloqueo optimista. `int` y no `double`.
          version: { bsonType: 'int', minimum: 0 },
          entries: {
            bsonType: 'array',
            // Como maximo las diez ranuras conceptuales (2 armas + 6 armaduras
            // + 2 items). El limite real por familia lo aplica el agregado.
            maxItems: 10,
            items: {
              bsonType: 'object',
              required: ['slot', 'itemId', 'productId'],
              additionalProperties: false,
              properties: {
                slot: { enum: EQUIPMENT_SLOTS },
                // El mismo patron kebab-case que exige `ItemId` en el dominio.
                itemId: { bsonType: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' },
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

export const down = async (db: Db): Promise<void> => {
  await db.collection('hero-loadouts').drop()
}
