import type { ExperienceThreshold } from '../../domain/policies/ExperiencePolicy'

/**
 * Vista de solo lectura de la progresion de un heroe (HU-08, RF-08).
 *
 * TRAZABILIDAD: este DTO nacio en la Task #188 (diseno), sin endpoint todavia
 * (la Task #188 dice que "no es obligatorio exponer esta operacion mediante
 * HTTP si la arquitectura final determina otro mecanismo de interaccion").
 * Auditoria de progresion en "Mi Inventario" (2026-09-27, Management HU-09.5
 * `#443`: "si la pantalla necesita el nivel actual... esa superficie se decide
 * en HU-09.1, no se inventa aqui") lo conecta: `ListAvailableHeroes` REUTILIZA
 * este mismo `GetHeroProgression` para anadir `progression` a cada heroe de
 * `GET /inventories/me/heroes`. Sigue sin haber un endpoint propio por heroe:
 * no hace falta uno para lo que hoy se pide.
 *
 * QUE LLEVA Y QUE NO.
 *   - Lleva el nivel y la experiencia acumulada, que son el estado persistido.
 *   - Lleva el UMBRAL, pero **derivado en el momento de leer**, no almacenado.
 *   - NO lleva el umbral como campo persistido, ni un historial, ni las
 *     estadisticas del heroe. Las estadisticas son de HU-28 y el nivel todavia no
 *     interviene en ellas (ver `CA-06` en `docs/hu-08-progresion.md`).
 *
 * `currentXp` ES EL ACUMULADO, NO LO QUE FALTA. Nunca se resta al subir de
 * nivel, asi que un heroe de nivel 4 puede llevar 13.000 acumulados sin que nada
 * este mal. Quien quiera saber cuanto le falta resta el umbral del acumulado; el
 * DTO no publica esa resta porque es una derivacion trivial y publicarla invitaria
 * a leerla como si fuera el estado.
 *
 * `maxLevel` viaja para que el consumidor no tenga que conocer el 8: el rango es
 * regla de negocio de este contexto y no deberia replicarse en la interfaz.
 *
 * `floorForCurrentLevel` SE AGREGA PARA QUE UN CONSUMIDOR VISUAL (Web, HU-09.5
 * y la progresion en "Mi Inventario") PUEDA PINTAR UNA BARRA DE PROGRESO SIN
 * CONOCER LA TABLA. Es la experiencia acumulada minima para estar en `level`
 * (0 en el nivel 1, que es el suelo). Con `floorForCurrentLevel`, `currentXp`
 * y `nextLevel.amount` el consumidor calcula `currentXp - floorForCurrentLevel`
 * sobre `nextLevel.amount - floorForCurrentLevel` sin reimplementar
 * `ExperiencePolicy`. Es DERIVADO -- se calcula en cada lectura delegando en la
 * MISMA politica que `nextLevel`, nunca se persiste ni introduce una segunda
 * tabla.
 */
export interface HeroProgressionDto {
  readonly heroId: string
  readonly level: number
  /** Experiencia ACUMULADA total. Solo crece; jamas se descuenta al subir. */
  readonly currentXp: number
  /**
   * Experiencia acumulada minima para estar en `level`. `0` en el nivel 1.
   * Derivado de la tabla vigente, nunca persistido.
   */
  readonly floorForCurrentLevel: number
  /**
   * Umbral del siguiente nivel -- la experiencia acumulada necesaria para
   * alcanzarlo -- o `MAX_LEVEL`. Derivado de la tabla vigente, nunca persistido.
   */
  readonly nextLevel: ExperienceThreshold
  readonly maxLevel: number
}
