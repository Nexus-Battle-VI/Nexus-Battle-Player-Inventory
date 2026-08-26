import type { Db } from 'mongodb'

/**
 * Esquema inicial de Player/Inventory.
 *
 * MongoDB no exige declarar nada antes de escribir, y por eso mismo hace falta
 * declararlo: una coleccion sin validador acepta un documento de cualquier
 * forma, incluido uno escrito por una version anterior del servicio o por
 * alguien conectado a mano al motor.
 *
 * Aqui esta la diferencia con Mongoose que motivo ADR-012. Un esquema de
 * Mongoose valida **en la aplicacion**: es una segunda comprobacion que repite
 * la del dominio y no protege de nada que no pase por el codigo. Este validador
 * vive **en el motor**, y es el equivalente exacto de las restricciones `CHECK`
 * que los servicios de PostgreSQL declaran en su migracion.
 *
 * Hay dos invariantes que el validador NO puede expresar, y conviene decirlo en
 * vez de aparentar que las cubre:
 *
 * - Que no se repita un objeto entre ranuras. `uniqueItems` compara documentos
 *   completos, no una propiedad, asi que dos ranuras del mismo objeto con
 *   distinta cantidad pasarian.
 * - Que el numero de ranuras no supere la capacidad. Seria comparar un campo
 *   con otro, y `$jsonSchema` no lo permite.
 *
 * Ambas las comprueba la traduccion al leer, y hay pruebas para las dos.
 *
 * `up` recibe `Db` a proposito y no un tipo del modelo actual: una migracion
 * queda congelada en el tiempo y tiene que seguir siendo ejecutable tal y como
 * se escribio, aunque el modelo cambie despues.
 */
export const up = async (db: Db): Promise<void> => {
  await db.createCollection('inventories', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'capacity', 'slots'],
        // Ningun campo mas: un documento con propiedades que el dominio no
        // conoce es basura que se leera algun dia como si significara algo.
        additionalProperties: false,
        properties: {
          // El identificador del propietario es la clave: un jugador tiene
          // exactamente un inventario, y MongoDB garantiza esa unicidad sin
          // indice adicional.
          _id: { bsonType: 'string', minLength: 1 },
          // `int` y no `double`: un recuento no es un numero con decimales, y
          // el driver guardaria un numero de JavaScript como doble.
          capacity: { bsonType: 'int', minimum: 1, maximum: 200 },
          slots: {
            bsonType: 'array',
            // La capacidad real la aplica el agregado; aqui solo se acota al
            // maximo que el dominio admite, para que un fallo de calculo no
            // escriba una lista absurda.
            maxItems: 200,
            items: {
              bsonType: 'object',
              required: ['itemId', 'quantity'],
              additionalProperties: false,
              properties: {
                // El mismo patron que exige `ItemId` en el dominio.
                itemId: { bsonType: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' },
                quantity: { bsonType: 'int', minimum: 1, maximum: 9999 },
              },
            },
          },
        },
      },
    },
    // Que rechace la escritura, no que la registre y siga. Un validador que
    // avisa es un validador que nadie lee.
    validationLevel: 'strict',
    validationAction: 'error',
  })
}

export const down = async (db: Db): Promise<void> => {
  await db.collection('inventories').drop()
}
