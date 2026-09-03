import type { HeroSelection } from '../../domain/entities/HeroSelection'
import type { PlayerId } from '../../domain/value-objects/identifiers'

/**
 * Puerto de persistencia de la seleccion de heroe (HU-07, RF-07).
 *
 * Un documento por jugador. La fuente de verdad vive en Player/Inventory: la
 * seleccion es una decision del jugador sobre SU inventario, no una propiedad
 * del catalogo.
 */
export interface HeroSelectionRepositoryPort {
  /** `null` cuando el jugador todavia no ha preparado ningun heroe. */
  findByOwner(ownerId: PlayerId): Promise<HeroSelection | null>

  /**
   * Guarda con bloqueo optimista: la escritura solo prospera si la version
   * almacenada sigue siendo `expectedVersion`. Si no, lanza
   * `HeroSelectionConflictError`. Devuelve la seleccion con la version nueva.
   */
  save(selection: HeroSelection, expectedVersion: number): Promise<HeroSelection>
}

export const HERO_SELECTION_REPOSITORY = Symbol('HeroSelectionRepositoryPort')
