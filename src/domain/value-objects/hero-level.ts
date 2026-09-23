import { DomainError } from '../errors/DomainError'

/**
 * Rango de niveles de un heroe (HU-08, RF-08).
 *
 * El nivel 1 es el inicial y el 8 el maximo: la HU #17 dice que "los heroes
 * progresan desde nivel 1 hasta nivel 8". Los dos limites son regla de negocio y
 * no se parametrizan, igual que las capacidades de equipamiento de HU-28
 * (`EQUIPMENT_CAPACITY`) no se leen de configuracion.
 *
 * Viven aqui, y no en `ExperiencePolicy`, porque los necesita tambien el
 * agregado `HeroProgression` y el propio objeto de valor: con los limites en la
 * politica, el objeto de valor tendria que importarla y la politica importa al
 * objeto de valor. Es el mismo criterio con el que `EquipmentSlot` y
 * `EQUIPMENT_CAPACITY` comparten archivo.
 */
export const MIN_HERO_LEVEL = 1
export const MAX_HERO_LEVEL = 8

/**
 * Nivel de un heroe: entero dentro de `1..8`.
 *
 * EL NIVEL ES DEL HEROE, NO DEL JUGADOR. Un jugador puede tener varios heroes y
 * cada uno progresa por su cuenta; es la misma decision que HU-11 tomo para el
 * Poder ("Pertenece al heroe, no al jugador"). Por eso este objeto de valor no
 * conoce a nadie mas que a si mismo: no lleva `heroId` ni `ownerId`, que son la
 * clave del agregado que lo contiene.
 *
 * NO NORMALIZA EN SILENCIO. Un `2.5` no se trunca a 2, un `"3"` no se convierte
 * a 3 y un `9` no se recorta a 8. La Task #188 exige rechazar el nivel inferior
 * a 1 y el superior a 8, y normalizar convertiria un error de datos en un
 * resultado plausible: el umbral de un nivel que el jugador no tiene.
 *
 * El nivel maximo es un valor VALIDO. Rechazarlo en el constructor haria
 * indistinguibles "este heroe ya no puede subir" y "me han pasado un nivel
 * invalido", que son situaciones opuestas y que `CA-05` pide separar. Lo que
 * ocurre en el nivel maximo lo decide la politica, no este objeto de valor.
 *
 * `isValid` es estatico y no lanza a proposito: hay llamadores que necesitan
 * PREGUNTAR si un valor sirve (una respuesta de Catalog, un parametro de ruta)
 * antes de construir nada. Es la misma razon por la que `HeroPowerPolicy` expone
 * `canAfford` ademas de `spendPower`: preguntar y decidir no deben discrepar.
 */
export class HeroLevel {
  readonly value: number

  private constructor(value: number) {
    this.value = value
  }

  /** `DomainError` si `raw` no es un entero entre `MIN_HERO_LEVEL` y `MAX_HERO_LEVEL`. */
  static create(raw: unknown): HeroLevel {
    if (!HeroLevel.isValid(raw)) {
      throw new DomainError(
        `El nivel del heroe debe ser un entero entre ${String(MIN_HERO_LEVEL)} y ${String(MAX_HERO_LEVEL)}. Se recibio ${describe(raw)}.`,
      )
    }

    return new HeroLevel(raw)
  }

  /** `true` solo si es entero y esta dentro del rango. Predicado, sin lanzar. */
  static isValid(raw: unknown): raw is number {
    return (
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw >= MIN_HERO_LEVEL &&
      raw <= MAX_HERO_LEVEL
    )
  }

  /** El nivel siguiente, o `null` en el nivel maximo. Nunca produce un nivel 9. */
  next(): HeroLevel | null {
    return this.value >= MAX_HERO_LEVEL ? null : new HeroLevel(this.value + 1)
  }

  isMax(): boolean {
    return this.value >= MAX_HERO_LEVEL
  }

  equals(other: HeroLevel): boolean {
    return this.value === other.value
  }
}

/** Representacion legible de un valor rechazado, sin volcar objetos enteros. */
const describe = (raw: unknown): string => {
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') return `"${raw}"`
  if (raw === null) return 'null'
  return typeof raw
}
