import { DomainError } from '../errors/DomainError'
import { MIN_HERO_LEVEL, HeroLevel } from '../value-objects/hero-level'
import { Experience } from '../value-objects/experience'
import {
  experienceRequiredForNextLevel,
  levelFromTotalXp,
  type ExperienceThreshold,
} from '../policies/ExperiencePolicy'

/** Estado persistido de la progresion de un heroe. */
export interface HeroProgressionSnapshot {
  readonly ownerId: string
  /** Identidad canonica (UUID) del producto HEROE. */
  readonly heroId: string
  readonly level: number
  /** Experiencia ACUMULADA. No es el umbral: el umbral es derivado y no se guarda. */
  readonly currentXp: number
  readonly version: number
}

/**
 * Progresion de un heroe: su nivel y su experiencia acumulada (HU-08, RF-08).
 *
 * ES UN AGREGADO POR (JUGADOR, HEROE), como `HeroLoadout` (HU-28) y no como
 * `HeroSelection` (HU-07), que es uno por jugador. La diferencia es deliberada:
 * la seleccion guarda QUE HEROE esta preparado y por eso elegir otro sustituye la
 * seleccion; el nivel y la experiencia son de cada heroe, asi que elegir otro
 * heroe no puede borrar el progreso del anterior. El `_id` del documento es
 * `"<ownerId>::<heroId>"`, el mismo estilo de clave compuesta que el loadout.
 *
 * POR QUE ES UN AGREGADO APARTE Y NO UN CAMPO DE OTRO.
 *   - No va en `HeroSelection`: ese agregado documenta expresamente que "ni las
 *     estadisticas ni el equipamiento viven aqui ... duplicarlos daria dos
 *     versiones de la misma verdad". El nivel no es una excepcion.
 *   - No va en `HeroLoadout`: el equipamiento y la progresion cambian por motivos
 *     distintos y con ritmos distintos, y meterlos juntos haria que subir de nivel
 *     compitiera por el bloqueo optimista con equipar un arma.
 *   - No va en Catalog: el nivel es estado del jugador, no un atributo de
 *     producto.
 *
 * EL NIVEL ES LA TABLA APLICADA AL ACUMULADO, Y ESO ES UNA INVARIANTE DEL
 * AGREGADO, no una coincidencia. La tabla vigente dice que el nivel
 * depende solo de la experiencia acumulada, asi que un documento que declare un
 * nivel que no corresponde a su acumulado esta corrupto y se rechaza al
 * restaurarlo en lugar de aceptarse en silencio. La consecuencia hay que decirla:
 * **cambiar la tabla obliga a migrar los documentos ya escritos**, porque el
 * nivel persistido dejaria de ser coherente con la tabla nueva. Es el precio de
 * guardar el nivel como estado y no recalcularlo en cada lectura.
 *
 * EL UMBRAL NO SE ALMACENA. `thresholdForNextLevel()` lo calcula delegando en
 * `ExperiencePolicy`. Guardarlo crearia un valor derivado que puede quedar
 * desincronizado y romperia el requisito de la Task #188 de que "la formula
 * existe en un unico punto conceptual del diseno".
 *
 * `version` habilita el bloqueo optimista del repositorio: dos recompensas
 * simultaneas no pueden acreditar experiencia dos veces sobre el mismo estado.
 *
 * LA EXPERIENCIA NUNCA SE RESTA. `awardExperience` suma y recalcula el nivel: no
 * descuenta el umbral, no reinicia el acumulado y no deja de sumar en el nivel
 * maximo.
 */
export class HeroProgression {
  readonly ownerId: string
  readonly heroId: string
  readonly level: HeroLevel
  readonly experience: Experience
  private readonly _version: number

  private constructor(
    ownerId: string,
    heroId: string,
    level: HeroLevel,
    experience: Experience,
    version: number,
  ) {
    this.ownerId = ownerId
    this.heroId = heroId
    this.level = level
    this.experience = experience
    this._version = version
  }

  /**
   * Progresion inicial de un heroe que todavia no ha ganado experiencia: nivel 1
   * con 0. El nivel inicial no lo fija la HU de forma distinta y el rango empieza
   * en 1; con 0 de experiencia acumulada el nivel que sale de la tabla es 1, asi
   * que el estado inicial es coherente por construccion.
   *
   * La creacion es PEREZOSA: un heroe sin documento de progresion se interpreta
   * con este valor y no se hace backfill ni se siembran documentos al seleccionar
   * un heroe.
   */
  static createEmpty(ownerId: string, heroId: string): HeroProgression {
    return new HeroProgression(
      requireIdentifier(ownerId, 'Una progresion necesita un jugador.'),
      requireIdentifier(heroId, 'Una progresion necesita un heroe.'),
      HeroLevel.create(MIN_HERO_LEVEL),
      Experience.zero(),
      0,
    )
  }

  /**
   * Reconstituye una progresion persistida. Valida el documento, no lo confia.
   *
   * Ademas del rango de cada campo comprueba la INVARIANTE del agregado: el nivel
   * guardado tiene que ser el que la tabla asigna al acumulado guardado. Un
   * documento que los contradiga es un dato corrupto --de una tabla anterior, de
   * una edicion manual, de una migracion a medias-- y se dice cual, en lugar de
   * devolver un heroe con un nivel que su experiencia no respalda.
   */
  static restore(snapshot: HeroProgressionSnapshot): HeroProgression {
    if (!Number.isInteger(snapshot.version) || snapshot.version < 0) {
      throw new DomainError('La version de la progresion debe ser un entero no negativo.')
    }

    const experience = Experience.create(snapshot.currentXp)
    const level = HeroLevel.create(snapshot.level)
    const expected = levelFromTotalXp(experience.currentXp)

    if (level.value !== expected) {
      throw new DomainError(
        `La progresion de ${snapshot.ownerId} y ${snapshot.heroId} declara el nivel ${String(level.value)} con ${String(experience.currentXp)} de experiencia acumulada, y esa experiencia corresponde al nivel ${String(expected)}.`,
      )
    }

    return new HeroProgression(
      requireIdentifier(snapshot.ownerId, 'Una progresion necesita un jugador.'),
      requireIdentifier(snapshot.heroId, 'Una progresion necesita un heroe.'),
      level,
      experience,
      snapshot.version,
    )
  }

  get version(): number {
    return this._version
  }

  /** `true` cuando el heroe ya no puede subir mas de nivel (nivel 8). */
  isAtMaxLevel(): boolean {
    return this.level.isMax()
  }

  /**
   * Umbral de experiencia para el siguiente nivel. NO se almacena: se calcula.
   * Devuelve `MAX_LEVEL` en el nivel maximo, sin producir nunca un nivel 9.
   */
  thresholdForNextLevel(): ExperienceThreshold {
    return experienceRequiredForNextLevel(this.level.value)
  }

  /**
   * Nivel que la tabla asigna a la experiencia acumulada actual.
   *
   * Coincide siempre con `level`, porque `restore` y `awardExperience` mantienen
   * la invariante; se expone para que el calculo sea legible y comprobable desde
   * fuera en vez de quedar enterrado en el constructor.
   */
  levelForTotalXp(): HeroLevel {
    return HeroLevel.create(levelFromTotalXp(this.experience.currentXp))
  }

  /**
   * Acredita una recompensa de experiencia y devuelve la progresion resultante.
   *
   * TRES COSAS QUE HACE Y CONVIENE LEER JUNTAS.
   *   1. SUMA. La experiencia es un acumulado que solo crece: subir de nivel no
   *      la consume. `749 + 100` deja 849 y el nivel pasa a 4.
   *   2. RECALCULA EL NIVEL DE UNA VEZ. El nivel nuevo se obtiene aplicando la
   *      tabla al acumulado nuevo, no avanzando un nivel por recompensa. Una
   *      sola acreditacion puede cruzar varios umbrales: `190 + 700 = 890` deja
   *      al heroe en el nivel 4, no en el 2.
   *   3. NO DESCARTA NADA EN EL NIVEL MAXIMO. Si el heroe ya esta en el 8, el
   *      acumulado sigue creciendo y el nivel se queda en 8. La operacion no se
   *      rechaza: la experiencia ganada no se pierde.
   *
   * NO INCREMENTA LA VERSION. El bloqueo optimista lo gobierna el repositorio,
   * que es quien conoce la version almacenada y quien incrementa al guardar. Si
   * esto subiera la version por su cuenta, el `expectedVersion` del llamador
   * dejaria de significar lo que dice.
   *
   * NO PERSISTE. Devuelve una progresion nueva; guardarla, con que version
   * esperada y con que idempotencia es responsabilidad de quien acredita la
   * recompensa (HU-09, HU-10) y del repositorio.
   */
  awardExperience(amount: unknown): HeroProgression {
    const experience = this.experience.add(amount)

    return new HeroProgression(
      this.ownerId,
      this.heroId,
      HeroLevel.create(levelFromTotalXp(experience.currentXp)),
      experience,
      this._version,
    )
  }

  toSnapshot(): HeroProgressionSnapshot {
    return {
      ownerId: this.ownerId,
      heroId: this.heroId,
      level: this.level.value,
      currentXp: this.experience.currentXp,
      version: this._version,
    }
  }
}

/** Rechaza identificadores vacios o en blanco sin recortar el valor por sorpresa. */
const requireIdentifier = (raw: unknown, message: string): string => {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new DomainError(message)
  }

  return raw.trim()
}
