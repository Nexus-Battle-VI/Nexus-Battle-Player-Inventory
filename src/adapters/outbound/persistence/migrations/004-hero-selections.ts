import type { Db } from 'mongodb'

/**
 * Esquema de la seleccion de heroe (HU-07, RF-07).
 *
 * UN DOCUMENTO POR JUGADOR, con el identificador del jugador como `_id`. Esa
 * eleccion es la que hace imposible que un jugador acabe con dos heroes
 * preparados a la vez: no es una comprobacion de la aplicacion que se pueda
 * olvidar, es la clave primaria del motor.
 *
 * El validador vive en el MOTOR, igual que en las migraciones anteriores: es el
 * equivalente de las restricciones CHECK de un motor relacional, no una segunda
 * comprobacion en la aplicacion.
 *
 * `up` recibe `Db` a proposito: una migracion queda congelada y debe seguir
 * siendo ejecutable tal como se escribio.
 */
export const up = async (db: Db): Promise<void> => {
  await db.createCollection('hero-selections', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'heroId', 'selectedAt', 'version'],
        additionalProperties: false,
        properties: {
          // Identificador del jugador tal como lo emite el proveedor de
          // identidad. No se le impone patron: es un sujeto opaco.
          _id: { bsonType: 'string', minLength: 1 },
          heroId: { bsonType: 'string', minLength: 1 },
          selectedAt: { bsonType: 'date' },
          // Version del bloqueo optimista. `int` y no `double`.
          version: { bsonType: 'int', minimum: 0 },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })
}

export const down = async (db: Db): Promise<void> => {
  await db.collection('hero-selections').drop()
}
