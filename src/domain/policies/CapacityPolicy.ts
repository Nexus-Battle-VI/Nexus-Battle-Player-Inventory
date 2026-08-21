import { DomainError } from '../errors/DomainError'

/**
 * Capacidad de un inventario, expresada en numero de ranuras distintas.
 *
 * Es una regla de negocio del contexto y no una constante de configuracion:
 * distintos tipos de jugador podrian tener capacidades distintas sin que el
 * agregado cambie.
 */
export class CapacityPolicy {
  static readonly DEFAULT_CAPACITY = 30
  static readonly MAX_CAPACITY = 200

  readonly capacity: number

  private constructor(capacity: number) {
    this.capacity = capacity
  }

  static of(capacity: number): CapacityPolicy {
    if (!Number.isInteger(capacity)) {
      throw new DomainError(`La capacidad debe ser un entero. Se recibio ${String(capacity)}.`)
    }

    if (capacity < 1 || capacity > CapacityPolicy.MAX_CAPACITY) {
      throw new DomainError(
        `La capacidad debe estar entre 1 y ${String(CapacityPolicy.MAX_CAPACITY)}. Se recibio ${String(capacity)}.`,
      )
    }

    return new CapacityPolicy(capacity)
  }

  static default(): CapacityPolicy {
    return new CapacityPolicy(CapacityPolicy.DEFAULT_CAPACITY)
  }
}
