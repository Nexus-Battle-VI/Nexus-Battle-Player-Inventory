import type { Db } from 'mongodb'

/**
 * Esquema de la progresion de un heroe (HU-08, RF-08).
 *
 * UN DOCUMENTO POR (JUGADOR, HEROE), con `_id` compuesto. Es el mismo criterio
 * que `002-hero-loadouts`: el nivel y la experiencia son de cada heroe, asi que
 * elegir otro heroe no puede tocar el progreso del anterior. La clave primaria
 * del motor es lo que lo garantiza, no una comprobacion de la aplicacion que se
 * pueda olvidar.
 *
 * EL UMBRAL NO CABE EN ESTE ESQUEMA, Y ES DELIBERADO. `additionalProperties:
 * false` hace que el motor RECHAZE cualquier documento con un campo de mas, de
 * modo que un intento futuro de persistir `nextLevelThreshold` falla al escribir
 * en lugar de crear un valor derivado que pueda quedar desincronizado con el
 * nivel. La Task #189 pide no persistir "el umbral calculado de manera
 * redundante", y aqui eso no depende de que nadie se acuerde: es el validador.
 *
 * `level` lleva `minimum` y `maximum` porque el rango 1..8 es regla de negocio
 * (lo repite `HeroLevel` en el dominio). Un documento fuera de rango es un dato
 * corrupto y el motor lo rechaza en la misma frontera.
 *
 * `currentXp` NO tiene techo: su techo es el umbral del nivel vigente, que es
 * derivado y cambia con el. Un maximo fijo obligaria a reescribir el documento
 * en cada subida de nivel y ataria el esquema a una regla de HU-09.
 *
 * `up` recibe `Db` a proposito: una migracion queda congelada y debe seguir
 * siendo ejecutable tal como se escribio.
 */
export const up = async (db: Db): Promise<void> => {
  await db.createCollection('hero-progressions', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'ownerId', 'heroId', 'level', 'currentXp', 'version'],
        additionalProperties: false,
        properties: {
          // "ownerId::heroId", el mismo separador que usa el loadout de heroe.
          _id: { bsonType: 'string', minLength: 1 },
          // Sujeto opaco del proveedor de identidad: no se le impone patron.
          ownerId: { bsonType: 'string', minLength: 1 },
          heroId: { bsonType: 'string', minLength: 1 },
          // Rango de niveles de RF-08. `int` y no `double`.
          level: { bsonType: 'int', minimum: 1, maximum: 8 },
          // Experiencia ACUMULADA del heroe. Sin techo (ver arriba).
          currentXp: { bsonType: 'int', minimum: 0 },
          // Version del bloqueo optimista.
          version: { bsonType: 'int', minimum: 0 },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  })
}

export const down = async (db: Db): Promise<void> => {
  await db.collection('hero-progressions').drop()
}
