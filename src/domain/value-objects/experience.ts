import { DomainError } from '../errors/DomainError'

/**
 * Experiencia ACUMULADA de un heroe (HU-08, RF-08).
 *
 * ES UN ACUMULADO QUE SOLO CRECE. La experiencia se suma y **nunca se resta**:
 * subir de nivel no la consume ni la reinicia, y llegar al nivel maximo no la
 * descarta. El nivel no es un contador de experiencia gastada, es el resultado de
 * comparar este acumulado con la tabla de umbrales, y por eso
 * `749 + 100 = 849` deja al heroe en el nivel 4 conservando los 849.
 *
 * NO TIENE TECHO. El techo aparente seria el ultimo umbral, pero la tabla es la
 * tabla del NIVEL, no un limite de acumulacion: en el nivel 8 el heroe sigue
 * ganando experiencia y su acumulado sigue creciendo (`13000 + 500 = 13500`,
 * nivel 8). Imponer aqui un maximo obligaria a descartar recompensas ya ganadas.
 * Lo unico que se exige es que sea un entero no negativo: no puede ser negativo
 * ni fraccionario, porque la tabla aprobada esta en enteros.
 *
 * QUIEN LO MUEVE. Este objeto de valor sabe SUMAR una recompensa, que es
 * aritmetica; quien decide cuando llega una recompensa y con que importe es
 * HU-09 (batalla) y HU-10 (misiones), no HU-08. Aqui no vive ni la tabla de
 * umbrales ni el calculo del nivel: eso es `ExperiencePolicy`.
 */
export class Experience {
  readonly currentXp: number

  private constructor(currentXp: number) {
    this.currentXp = currentXp
  }

  /** `DomainError` si `raw` no es un entero no negativo. */
  static create(raw: unknown): Experience {
    return new Experience(requireNonNegativeInteger(raw, 'La experiencia acumulada'))
  }

  /** Experiencia inicial de un heroe que todavia no ha ganado ninguna. */
  static zero(): Experience {
    return new Experience(0)
  }

  /**
   * Suma una recompensa de experiencia y devuelve el nuevo acumulado.
   *
   * NO RESTA NI ACOTA, y no puede hacerlo: no conoce el nivel del heroe ni la
   * tabla de umbrales. Recibe un importe, que ya viene redondeado a entero por
   * quien lo calculo, y lo suma. La cantidad tiene que ser un entero no negativo:
   * una recompensa fraccionaria es un error de quien la calculo y se rechaza en
   * lugar de redondearse por sorpresa aqui.
   *
   * Es INMUTABLE, como el resto del objeto de valor: no modifica esta instancia,
   * devuelve otra. Eso es lo que permite reintentar una acreditacion sin miedo a
   * haber mutado el estado por el camino.
   */
  add(amount: unknown): Experience {
    return new Experience(
      this.currentXp + requireNonNegativeInteger(amount, 'La experiencia acreditada'),
    )
  }

  equals(other: Experience): boolean {
    return this.currentXp === other.currentXp
  }
}

/** Rechaza importes que no sean enteros no negativos, diciendo cual. */
const requireNonNegativeInteger = (raw: unknown, what: string): number => {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new DomainError(`${what} debe ser un entero no negativo. Se recibio ${describe(raw)}.`)
  }

  return raw
}

/** Representacion legible de un valor rechazado, sin volcar objetos enteros. */
const describe = (raw: unknown): string => {
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') return `"${raw}"`
  if (raw === null) return 'null'
  return typeof raw
}
