import type { Db } from 'mongodb'

/**
 * Recalcula el nivel de las progresiones YA persistidas con la tabla de umbrales
 * acumulados vigente de HU-08.
 *
 * La tabla temporal anterior (`100, 200, 400, ... 12800`) asignaba niveles
 * distintos al mismo acumulado: un heroe con 301 XP era nivel 2 y ahora es nivel
 * 3. `HeroProgression.restore` rechaza como corrupto un documento cuyo nivel no
 * coincide con el que la tabla asigna a su XP, asi que sin esta migracion esos
 * heroes dejarian de poder leerse tras el despliegue.
 *
 * LA XP NO SE TOCA: es la fuente de verdad y solo el nivel derivado se corrige.
 *
 * Los umbrales estan copiados AQUI a proposito: una migracion queda congelada y
 * debe seguir siendo ejecutable tal como se escribio aunque `ExperiencePolicy`
 * cambie despues (mismo criterio que el resto de migraciones). No es una segunda
 * regla de negocio: es una foto de la tabla vigente en el momento de migrar.
 *
 * Es idempotente: aplicarla dos veces deja el mismo resultado.
 */
const LEVEL_UP_AT_OR_ABOVE = [1300, 1100, 900, 700, 500, 300, 100] as const

export const up = async (db: Db): Promise<void> => {
  const branches = LEVEL_UP_AT_OR_ABOVE.map((threshold, index) => ({
    case: { $gte: ['$currentXp', threshold] },
    then: 8 - index,
  }))

  await db
    .collection('hero-progressions')
    .updateMany({}, [{ $set: { level: { $toInt: { $switch: { branches, default: 1 } } } } }])
}
