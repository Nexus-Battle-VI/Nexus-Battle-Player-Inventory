/**
 * Desbloqueo de las habilidades especiales por nivel del heroe (EN-031).
 *
 * Decision de producto del 2026-10-11, que cierra la cuestion abierta de
 * `docs/hu-08-progresion.md`: las habilidades de un heroe se desbloquean por la
 * POSICION en que Catalog las declara en el producto HEROE, no por un atributo
 * de cada habilidad. La primera esta disponible desde el nivel 1, la segunda en
 * el 3 y la tercera en el 5 (300 y 700 XP acumulados, segun
 * `LEVEL_UP_THRESHOLDS`). Una cuarta o posterior, si algun dia existe, queda en
 * el ultimo escalon: nunca se desbloquea antes que la tercera.
 *
 * Este modulo solo informa el nivel; quien bloquea es Combat, que conoce el
 * nivel del heroe en la batalla y rechaza la habilidad (`SKILL_LOCKED`).
 */
export const ABILITY_UNLOCK_LEVELS = [1, 3, 5] as const

/** Nivel en que se desbloquea la habilidad declarada en `position` (base 0). */
export const abilityUnlockLevel = (position: number): number => {
  if (!Number.isSafeInteger(position) || position < 0) {
    throw new RangeError('La posicion de una habilidad debe ser un entero no negativo.')
  }

  return ABILITY_UNLOCK_LEVELS[Math.min(position, ABILITY_UNLOCK_LEVELS.length - 1)] ?? 1
}
