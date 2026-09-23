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
 * QUE ES EXACTAMENTE UN UMBRAL AQUI, porque la palabra admite dos lecturas y
 * confundirlas seria un error de una sola direccion: es la EXPERIENCIA
 * ACUMULADA TOTAL que el heroe necesita tener para estar en un nivel. **No** es
 * la cantidad que le falta, ni un incremento que se suma aparte. La experiencia
 * del heroe nunca se resta al subir de nivel, asi que comparar el acumulado con
 * esta tabla es todo lo que hace falta para conocer su nivel.
 *
 * NO REPARTE EXPERIENCIA. Aqui solo se calcula el umbral y se resuelve que nivel
 * corresponde a un acumulado. Quien acredita la experiencia, cuando y con que
 * recompensa es HU-09 (batalla) y HU-10 (misiones): esta politica no conoce la
 * formula de recompensa `10 x 1,2^(1d8)`, que pertenece a Missions y al azar de
 * Combat, no a Player/Inventory.
 */

export { MAX_HERO_LEVEL, MIN_HERO_LEVEL }

/**
 * TABLA INSTITUCIONAL DEL UMBRAL, APROBADA POR EL PRODUCT OWNER.
 *
 * `EXPERIENCE_THRESHOLDS[L - 1]` es la experiencia ACUMULADA que el heroe
 * necesita para estar en el nivel `L`:
 *
 *   nivel      1     2     3     4      5      6      7       8
 *   umbral   100   200   400   800   1600   3200   6400   12800
 *
 * Los ocho valores son los que aprobo el Product Owner. Son enteros cerrados y
 * la serie es exactamente `100 x 2^(L - 1)`: se conserva la estructura
 * `100 x base^(exponente)` del enunciado original y lo que cambia es la base
 * (2 en lugar de 1,2) y el significado del subindice (acumulado para estar en el
 * nivel, no incremento para pasar al siguiente).
 *
 * POR QUE NO SE CALCULA CON UNA FORMULA. La Task #188 prohibe "introducir una
 * politica de redondeo definitiva mientras no exista una decision funcional
 * aprobada". Con la tabla aprobada el problema desaparece: no hay nada que
 * redondear porque no hay coma flotante, y la regla queda escrita con los ocho
 * valores que el PO aprobo en lugar de con una expresion que los reproduzca. Una
 * tabla literal es ademas lo unico que se puede contrastar linea a linea contra
 * la aprobacion.
 *
 * DIVERGENCIA VIGENTE QUE NO SE TAPA AQUI. `CA-03` de la HU #17 exige el umbral
 * `100 x 1,2^(Nivel - 1)`, que produce `100, 120, 144, 172,8, 207,36, 248,832,
 * 298,5984` -- otra serie, y con decimales. La tabla aprobada la sustituye. La
 * Task #188 manda no decidir esto por cuenta propia y la aclaracion del PO es
 * posterior al enunciado, asi que la tabla gobierna el calculo y la divergencia
 * queda registrada en `docs/hu-08-progresion.md` para que el PO corrija `CA-03`
 * en lugar de que este codigo finja que ambos coinciden.
 */
export const EXPERIENCE_THRESHOLDS: readonly number[] = Object.freeze([
  100, // nivel 1
  200, // nivel 2
  400, // nivel 3
  800, // nivel 4
  1600, // nivel 5
  3200, // nivel 6
  6400, // nivel 7
  12800, // nivel 8
])

/**
 * Resultado del calculo. Es una union discriminada y NO un valor nullable ni una
 * excepcion para el nivel maximo: "este heroe ya no puede subir" y "me han
 * pasado un nivel invalido" son situaciones opuestas y no deben confundirse.
 *
 * En `AVAILABLE`, `forNextLevel` es siempre `currentLevel + 1` y nunca supera
 * `MAX_HERO_LEVEL`: la politica jamas calcula el umbral de un nivel 9 (CA-05), y
 * `amount` es la experiencia acumulada necesaria para ALCANZAR ese nivel.
 *
 * `amount` es un entero, no un decimal exacto: la tabla aprobada no tiene
 * fracciones. La version anterior de esta politica devolvia ademas un campo
 * `decimal` con la representacion exacta de `100 x 1,2^(n-1)`; se retiro junto
 * con la formula, porque ya no hay ningun valor fraccionario que representar.
 */
export type ExperienceThreshold =
  | {
      readonly status: 'AVAILABLE'
      /** Nivel al que conduce el umbral calculado. Siempre `currentLevel + 1`. */
      readonly forNextLevel: number
      /**
       * Experiencia ACUMULADA TOTAL necesaria para estar en `forNextLevel`,
       * segun la tabla aprobada. Es el mismo numero que `levelFromTotalXp`
       * compara: llegar a el es lo que produce el ascenso.
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
 * En resumen, `1..7 -> AVAILABLE` con umbrales `200, 400, 800, 1600, 3200,
 * 6400, 12800`. El nivel 1 necesita 200 acumulados para llegar al 2 porque con
 * 100 acumulados el heroe SIGUE estando en el nivel 1: la tabla reserva 100 para
 * "estar en el nivel 1".
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
    amount: thresholdToReach(forNextLevel),
  }
}

/**
 * Nivel que corresponde a una experiencia ACUMULADA: `nivel(xp) = mayor L de
 * 1..8 tal que xp >= UMBRAL[L]`.
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

  for (let level = MIN_HERO_LEVEL; level <= MAX_HERO_LEVEL; level += 1) {
    if (xp >= thresholdToReach(level)) {
      reached = level
    }
  }

  return reached
}

/**
 * Experiencia acumulada necesaria para ALCANZAR `level`, segun la tabla.
 *
 * Es `private` al modulo a proposito: la tabla se lee por sus dos operaciones
 * publicas y no por su indice. Un consumidor que indexara la tabla directamente
 * estaria reimplementando la regla.
 */
const thresholdToReach = (level: number): number => {
  const threshold = EXPERIENCE_THRESHOLDS[level - MIN_HERO_LEVEL]

  if (threshold === undefined) {
    throw new DomainError(
      `No hay umbral de experiencia para el nivel ${describe(level)}: la tabla cubre los niveles ${String(MIN_HERO_LEVEL)} a ${String(MAX_HERO_LEVEL)}.`,
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
