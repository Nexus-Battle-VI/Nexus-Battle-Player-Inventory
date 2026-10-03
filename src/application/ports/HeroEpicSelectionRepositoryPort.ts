import type { HeroEpicSelection } from '../../domain/entities/HeroEpicSelection'
import type { PlayerId } from '../../domain/value-objects/identifiers'

/**
 * Puerto de persistencia de la epica equipada de un heroe (HU-31, contrato
 * `hu-31-equipped-epic-v1`).
 *
 * Agregado hermano de `HeroLoadoutRepositoryPort`: mismo criterio de
 * documento unico por (jugador, heroe) y bloqueo optimista por version, sin
 * compartir coleccion ni mezclar su ciclo de vida con el loadout 2/6/2.
 */
export interface HeroEpicSelectionRepositoryPort {
  /** `null` cuando el heroe todavia no tiene ninguna epica equipada. */
  findByHero(ownerId: PlayerId, heroId: string): Promise<HeroEpicSelection | null>

  /**
   * Guarda la seleccion con bloqueo optimista: la escritura solo prospera si
   * la version almacenada sigue siendo `expectedVersion`. Si no, lanza
   * `HeroEpicSelectionConflictError`. Devuelve la seleccion con la version
   * incrementada.
   */
  save(selection: HeroEpicSelection, expectedVersion: number): Promise<HeroEpicSelection>
}

export const HERO_EPIC_SELECTION_REPOSITORY = Symbol('HeroEpicSelectionRepositoryPort')
