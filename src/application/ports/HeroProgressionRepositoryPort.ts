import type { HeroProgression } from '../../domain/entities/HeroProgression'
import type { PlayerId } from '../../domain/value-objects/identifiers'

/**
 * Puerto de persistencia de la progresion de un heroe (HU-08, RF-08).
 *
 * La fuente de verdad del nivel y de la experiencia vive EN Player/Inventory, en
 * su propio almacen. Ningun otro servicio la lee. Es un agregado por
 * (jugador, heroe), como `HeroLoadoutRepositoryPort` (HU-28): un solo documento
 * cuya escritura es atomica.
 *
 * EL UMBRAL NO TIENE PUERTO NI COLECCION. No se persiste: se calcula con
 * `ExperiencePolicy`. No hay `findThreshold`, ni cache, ni proyeccion, y su
 * ausencia es deliberada.
 *
 * ESTE PUERTO ES CONTRATO DE DISENO (Task #188). Su adaptador Mongo y la
 * migracion `008-hero-progressions` son la Task #189; hoy no existe
 * implementacion y por tanto no se registra en el contenedor.
 */
export interface HeroProgressionRepositoryPort {
  /**
   * Recupera la progresion de un heroe del jugador.
   *
   * `null` cuando el heroe todavia no tiene documento. NO es un error y NO se
   * siembra al vuelo: el llamador interpreta `null` como el estado inicial
   * (`HeroProgression.createEmpty`, nivel 1 con 0 de experiencia).
   */
  findByHero(ownerId: PlayerId, heroId: string): Promise<HeroProgression | null>

  /**
   * Guarda la progresion con bloqueo optimista: la escritura solo prospera si la
   * version almacenada sigue siendo `expectedVersion`. Si no, lanza
   * `HeroProgressionConflictError`. Devuelve la progresion con la version
   * incrementada.
   *
   * El bloqueo es lo que impide que dos recompensas simultaneas acrediten
   * experiencia dos veces sobre el mismo estado: la segunda escritura choca de
   * version en lugar de sumar sobre un valor ya superado.
   */
  save(progression: HeroProgression, expectedVersion: number): Promise<HeroProgression>
}

export const HERO_PROGRESSION_REPOSITORY = Symbol('HeroProgressionRepositoryPort')
