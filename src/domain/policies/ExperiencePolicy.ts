import { DomainError } from '../errors/DomainError'
import { Experience } from '../value-objects/experience'
import { MAX_HERO_LEVEL, MIN_HERO_LEVEL, HeroLevel } from '../value-objects/hero-level'

/**
 * Umbral de experiencia por nivel (HU-08, RF-08).
 *
 * LA REGLA VIVE AQUI Y EN NINGUN OTRO SITIO. La Task #189 prohibe expresamente
 * que "quede duplicada en HU-09, HU-10 ni en otros modulos", y la Task #188
 * exige que "la formula existe en un unico punto conceptual del diseno".
 * Cualquier consumidor que necesite el umbral (HU-09 al acreditar experiencia
 * por victoria, HU-10 al hacerlo por mision) pide este resultado; no lo
 * recalcula ni copia la tabla.
 *
 * FUNCION PURA: no lee ni escribe, no conoce el reloj, la persistencia, el azar
 * ni el framework, no muta su entrada y no guarda estado entre llamadas. El
 * mismo nivel produce siempre el mismo umbral.
 *
 * EL UMBRAL NO SE PERSISTE. Es derivable del nivel y la Task #188 prohibe
 * almacenar "un valor que puede calcularse de forma deterministica". El estado
 * que si se guarda -- nivel y experiencia acumulada -- vive en `HeroProgression`.
 *
 * QUE ES EXACTAMENTE UN UMBRAL AQUI (decision funcional vigente): es la
 * EXPERIENCIA ACUMULADA TOTAL que el heroe necesita tener para PASAR de su nivel
 * actual al siguiente. El umbral del nivel `L` se indexa por el nivel del que se
 * sale (`L -> L + 1`), no por el nivel al que se llega. **No** es la cantidad que
 * le falta ni un incremento que se suma aparte: la experiencia nunca se resta al
 * subir de nivel, asi que comparar el acumulado con esta tabla basta para conocer
 * su nivel. `100 XP` significa "se alcanzo el umbral para pasar del 1 al 2", no
 * "100 XP es el nivel 1".
 *
 * NO REPARTE EXPERIENCIA. Aqui solo se calcula el umbral y se resuelve que nivel
 * corresponde a un acumulado. Quien acredita la experiencia, cuando y con que
 * recompensa es HU-09 (batalla) y HU-10 (misiones): esta politica no conoce la
 * formula de recompensa `10 x 1,2^(1d8)`, que pertenece a Missions y al azar de
 * Combat, no a Player/Inventory.
 */

export { MAX_HERO_LEVEL, MIN_HERO_LEVEL }

/**
 * TABLA VIGENTE, FIJADA POR UNA DECISION FUNCIONAL POSTERIOR AL ENUNCIADO.
 *
 * `LEVEL_UP_THRESHOLDS[L - 1]` es la experiencia ACUMULADA necesaria para pasar
 * del nivel `L` al `L + 1`:
 *
 *   paso        1->2  2->3  3->4  4->5  5->6  6->7   7->8
 *   umbral      100   300   500   700   900   1100   1300
 *
 * Por tanto: 0..99 => nivel 1, 100..299 => 2, 300..499 => 3, 500..699 => 4,
 * 700..899 => 5, 900..1099 => 6, 1100..1299 => 7, >= 1300 => 8. El nivel 8 es el
 * maximo y NO existe umbral para un nivel 9 (por eso la tabla tiene siete
 * entradas y no ocho).
 *
 * ESTA TABLA SUSTITUYE, POR DECISION FUNCIONAL POSTERIOR, A LA FORMULA ORIGINAL
 * DEL PDF (`100 x 1,2^(Nivel - 1)`) Y A LA TABLA TEMPORAL ANTERIOR
 * (`100, 200, 400, 800, 1600, 3200, 6400, 12800`). No estaba en el PDF: no debe
 * presentarse como si lo estuviera. CA-03 de la HU #17 se corrige en Management
 * para que coincida con esta tabla.
 *
 * Enteros cerrados, sin coma flotante ni redondeo: no hay nada que decidir.
 */
export const LEVEL_UP_THRESHOLDS: readonly number[] = Object.freeze([
  100, // 1 -> 2
  300, // 2 -> 3
  500, // 3 -> 4
  700, // 4 -> 5
  900, // 5 -> 6
  1100, // 6 -> 7
  1300, // 7 -> 8
])

/**
 * Resultado del calculo. Es una union discriminada y NO un valor nullable ni una
 * excepcion para el nivel maximo: "este heroe ya no puede subir" y "me han
 * pasado un nivel invalido" son situaciones opuestas y no deben confundirse.
 *
 * En `AVAILABLE`, `forNextLevel` es siempre `currentLevel + 1` y nunca supera
 * `MAX_HERO_LEVEL`: la politica jamas calcula el umbral de un nivel 9 (CA-05), y
 * `amount` es la experiencia acumulada necesaria para PASAR del nivel actual a ese.
 *
 * `amount` es un entero: la tabla vigente no tiene fracciones.
 */
export type ExperienceThreshold =
  | {
      readonly status: 'AVAILABLE'
      /** Nivel al que conduce el umbral calculado. Siempre `currentLevel + 1`. */
      readonly forNextLevel: number
      /**
       * Experiencia ACUMULADA TOTAL necesaria para pasar del nivel actual a
       * `forNextLevel`. Es el mismo numero que `levelFromTotalXp` compara:
       * alcanzarlo es lo que produce el ascenso.
       */
      readonly amount: number
    }
  | {
      readonly status: 'MAX_LEVEL'
      readonly currentLevel: number
      readonly forNextLevel: null
      readonly amount: null
    }

/**
 * `true` solo si el valor es un entero dentro de `1..8`.
 *
 * Existe ademas de `HeroLevel.create` porque hay llamadores que necesitan
 * PREGUNTAR si un valor sirve sin construir un objeto de valor que lanzaria
 * (una respuesta de Catalog, un parametro de ruta). Es la misma razon por la que
 * `HeroPowerPolicy` expone `canAfford` ademas de `spendPower`.
 */
export const isHeroLevel = (value: unknown): value is number => HeroLevel.isValid(value)

/**
 * Umbral de experiencia acumulada para pasar del nivel actual al siguiente.
 *
 * Entrada: el nivel ACTUAL del heroe. No el nivel destino, no el heroe, no su
 * equipamiento: la Task #188 dice que "el calculo debe utilizar como entrada el
 * nivel actual del heroe" y que el umbral no depende de nada mas.
 *
 * - `1..7` -> `AVAILABLE` con el umbral del nivel siguiente.
 * - `8`    -> `MAX_LEVEL`, sin calcular umbral y sin producir un nivel 9.
 * - cualquier otra cosa -> `DomainError`, sin normalizar en silencio.
 *
 * En resumen, `1..7 -> AVAILABLE` con umbrales `100, 300, 500, 700, 900, 1100,
 * 1300`: el nivel 1 pasa al 2 al llegar a 100 acumulados.
 *
 * El tipo de la entrada es `unknown` a proposito: obliga a validar en la
 * frontera, donde el dato puede venir de un documento persistido antiguo, de una
 * respuesta de otro servicio o de un parametro de ruta.
 */
export const experienceRequiredForNextLevel = (currentLevel: unknown): ExperienceThreshold => {
  if (!isHeroLevel(currentLevel)) {
    throw new DomainError(
      `El nivel del heroe debe ser un entero entre ${String(MIN_HERO_LEVEL)} y ${String(MAX_HERO_LEVEL)}. Se recibio ${describe(currentLevel)}.`,
    )
  }

  if (currentLevel >= MAX_HERO_LEVEL) {
    return {
      status: 'MAX_LEVEL',
      currentLevel,
      forNextLevel: null,
      amount: null,
    }
  }

  const forNextLevel = currentLevel + 1

  return {
    status: 'AVAILABLE',
    forNextLevel,
    amount: thresholdToLeave(currentLevel),
  }
}

/**
 * Nivel que corresponde a una experiencia ACUMULADA: `nivel(xp) = 1 + numero de
 * umbrales de la tabla que xp alcanza o supera` (maximo 8).
 *
 * ES LA OPERACION QUE HACE POSIBLE SUBIR MAS DE UN NIVEL CON UNA SOLA
 * RECOMPENSA. Una acreditacion calcula el nivel DIRECTAMENTE a partir del nuevo
 * acumulado, sin pasar por los niveles intermedios ni detenerse en el primero:
 * `190 + 700 = 890` cae en el nivel 4 de una vez, y no en el 2.
 *
 * ES MONOTONA Y TOTAL. La tabla crece estrictamente, asi que mas experiencia
 * nunca da menos nivel, y cualquier acumulado no negativo tiene nivel. Por
 * debajo del primer umbral el resultado es el nivel 1: el nivel 1 es el suelo y
 * no hace falta experiencia para tenerlo.
 *
 * ESTA ES LA MISMA COMPARACION QUE HACE LA TABLA AL CONSULTAR EL UMBRAL. Existe
 * como funcion propia porque HU-09 y HU-10 necesitan las dos direcciones: saber
 * cuanto hace falta para subir y saber en que nivel quedo el heroe despues de
 * acreditar la recompensa.
 *
 * El tope en 8 no descarta experiencia: un heroe en el nivel maximo sigue
 * acumulando y su nivel se queda en 8. La operacion no rechaza nada por ir por
 * encima de la tabla, porque la experiencia ganada no se pierde.
 */
export const levelFromTotalXp = (totalXp: unknown): number => {
  // La validacion del acumulado la hace el objeto de valor que lo representa:
  // preguntar y decidir no deben poder discrepar.
  const xp = Experience.create(totalXp).currentXp

  let reached = MIN_HERO_LEVEL

  for (let level = MIN_HERO_LEVEL; level < MAX_HERO_LEVEL; level += 1) {
    if (xp >= thresholdToLeave(level)) {
      reached = level + 1
    }
  }

  return reached
}

/**
 * Experiencia acumulada necesaria para PASAR de `level` al siguiente, segun la
 * tabla. Solo existe para los niveles `1..7`.
 *
 * Es `private` al modulo a proposito: la tabla se lee por sus dos operaciones
 * publicas y no por su indice. Un consumidor que indexara la tabla directamente
 * estaria reimplementando la regla.
 */
const thresholdToLeave = (level: number): number => {
  const threshold = LEVEL_UP_THRESHOLDS[level - MIN_HERO_LEVEL]

  if (threshold === undefined) {
    throw new DomainError(
      `No hay umbral de experiencia para salir del nivel ${describe(level)}: la tabla cubre los niveles ${String(MIN_HERO_LEVEL)} a ${String(MAX_HERO_LEVEL - 1)}.`,
    )
  }

  return threshold
}

/** Representacion legible de un valor rechazado, sin volcar objetos enteros. */
const describe = (raw: unknown): string => {
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') return `"${raw}"`
  if (raw === null) return 'null'
  return typeof raw
}
