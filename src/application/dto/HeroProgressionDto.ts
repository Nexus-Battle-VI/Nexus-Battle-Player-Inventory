import type { ExperienceThreshold } from '../../domain/policies/ExperiencePolicy'

/**
 * Vista de solo lectura de la progresion de un heroe (HU-08, RF-08).
 *
 * TRAZABILIDAD: este DTO es de la Task #188 (diseno). Acompana al modelo de
 * dominio para dejar fijada la forma de la lectura; NO lo sirve todavia ningun
 * endpoint, porque este diseno no expone HTTP (la Task #188 dice que "no es
 * obligatorio exponer esta operacion mediante HTTP si la arquitectura final
 * determina otro mecanismo de interaccion"). El caso de uso que lo produce y, si
 * el PO lo pide, su controlador son trabajo posterior.
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
 */
export interface HeroProgressionDto {
  readonly heroId: string
  readonly level: number
  /** Experiencia ACUMULADA total. Solo crece; jamas se descuenta al subir. */
  readonly currentXp: number
  /**
   * Umbral del siguiente nivel -- la experiencia acumulada necesaria para
   * alcanzarlo -- o `MAX_LEVEL`. Derivado de la tabla vigente, nunca persistido.
   */
  readonly nextLevel: ExperienceThreshold
  readonly maxLevel: number
}
