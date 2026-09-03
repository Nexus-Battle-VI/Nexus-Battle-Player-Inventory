import type { HeroLoadout } from '../../domain/entities/HeroLoadout'
import type { PlayerId } from '../../domain/value-objects/identifiers'

/**
 * Puerto de persistencia del equipamiento de un heroe (RF-28).
 *
 * La fuente de verdad del loadout vive EN Player/Inventory, en su propio
 * almacen. Ningun otro servicio la lee. Es un agregado por (jugador, heroe): un
 * solo documento cuya escritura es atomica.
 */
export interface HeroLoadoutRepositoryPort {
  /**
   * Recupera el loadout de un heroe del jugador. `null` cuando el heroe aun no
   * tiene ninguna pieza equipada.
   */
  findByHero(ownerId: PlayerId, heroId: string): Promise<HeroLoadout | null>

  /**
   * Guarda el loadout con bloqueo optimista: la escritura solo prospera si la
   * version almacenada sigue siendo `expectedVersion`. Si no, lanza
   * `HeroLoadoutConflictError`. Devuelve el loadout con la version incrementada.
   */
  save(loadout: HeroLoadout, expectedVersion: number): Promise<HeroLoadout>
}

export const HERO_LOADOUT_REPOSITORY = Symbol('HeroLoadoutRepositoryPort')
