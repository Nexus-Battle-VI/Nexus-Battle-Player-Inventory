import { DomainError } from '../errors/DomainError'

/**
 * Identidad del jugador propietario del inventario.
 *
 * Es una referencia al contexto Account: este servicio no conoce el correo, el
 * nombre ni los roles del jugador. Solo su identificador. Esa frontera es
 * deliberada y evita duplicar el modelo de cuentas.
 */
export class PlayerId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): PlayerId {
    const normalized = raw.trim()

    if (normalized.length === 0) {
      throw new DomainError('El identificador del jugador no puede estar vacio.')
    }

    return new PlayerId(normalized)
  }

  equals(other: PlayerId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Identidad de un objeto del catalogo.
 *
 * Referencia al contexto Catalog. El inventario no conoce el nombre, el precio
 * ni la descripcion del objeto: solo que lo posee y en que cantidad.
 */
export class ItemId {
  private static readonly PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
  private static readonly UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(raw: string): ItemId {
    const normalized = raw.trim().toLowerCase()

    if (!ItemId.PATTERN.test(normalized) && !ItemId.UUID.test(normalized)) {
      throw new DomainError(
        `El identificador de objeto "${raw}" no es valido. Se espera UUID o referencia legacy kebab-case.`,
      )
    }

    return new ItemId(normalized)
  }

  equals(other: ItemId): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/**
 * Cantidad de unidades de un objeto.
 *
 * Es un entero estrictamente positivo: una ranura con cero unidades no existe,
 * se elimina. Modelarlo como objeto de valor impide que una cantidad negativa
 * o fraccionaria entre al agregado.
 */
export class Quantity {
  static readonly MAX = 9_999

  readonly value: number

  private constructor(value: number) {
    this.value = value
  }

  static create(raw: number): Quantity {
    if (!Number.isInteger(raw)) {
      throw new DomainError(`La cantidad debe ser un numero entero. Se recibio ${String(raw)}.`)
    }

    if (raw < 1) {
      throw new DomainError(`La cantidad debe ser mayor o igual a 1. Se recibio ${String(raw)}.`)
    }

    if (raw > Quantity.MAX) {
      throw new DomainError(
        `La cantidad no puede superar ${String(Quantity.MAX)}. Se recibio ${String(raw)}.`,
      )
    }

    return new Quantity(raw)
  }

  plus(other: Quantity): Quantity {
    return Quantity.create(this.value + other.value)
  }

  /** Devuelve `null` cuando la resta agota la cantidad. */
  minus(other: Quantity): Quantity | null {
    if (other.value > this.value) {
      throw new DomainError(
        `No se pueden retirar ${String(other.value)} unidades de una cantidad de ${String(this.value)}.`,
      )
    }

    const remaining = this.value - other.value

    return remaining === 0 ? null : Quantity.create(remaining)
  }

  equals(other: Quantity): boolean {
    return this.value === other.value
  }
}
