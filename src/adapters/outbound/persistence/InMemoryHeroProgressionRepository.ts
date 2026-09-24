import {
  HeroProgression,
  type HeroProgressionSnapshot,
} from '../../../domain/entities/HeroProgression'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroProgressionConflictError } from '../../../application/errors/ApplicationError'
import type { HeroProgressionRepositoryPort } from '../../../application/ports/HeroProgressionRepositoryPort'

/**
 * Repositorio en memoria de la progresion de un heroe.
 *
 * Almacena instantaneas, no el agregado vivo: una mutacion sin guardar no se
 * filtra al almacen. Reproduce el bloqueo optimista de MongoDB comparando la
 * version esperada con la almacenada, para que las pruebas de los casos de uso
 * ejerciten el conflicto sin contenedor.
 *
 * La clave lleva el mismo separador (`::`) que el documento real, de modo que la
 * clave de una prueba y la de produccion son la misma cadena.
 */
export class InMemoryHeroProgressionRepository implements HeroProgressionRepositoryPort {
  private readonly byKey = new Map<string, HeroProgressionSnapshot>()

  private static key(ownerId: string, heroId: string): string {
    return `${ownerId}::${heroId}`
  }

  findByHero(ownerId: PlayerId, heroId: string): Promise<HeroProgression | null> {
    const snapshot = this.byKey.get(InMemoryHeroProgressionRepository.key(ownerId.value, heroId))

    return Promise.resolve(snapshot === undefined ? null : HeroProgression.restore(snapshot))
  }

  save(progression: HeroProgression, expectedVersion: number): Promise<HeroProgression> {
    const key = InMemoryHeroProgressionRepository.key(progression.ownerId, progression.heroId)
    const current = this.byKey.get(key)
    const storedVersion = current?.version ?? 0

    if (storedVersion !== expectedVersion) {
      return Promise.reject(new HeroProgressionConflictError(progression.heroId))
    }

    const snapshot = progression.toSnapshot()
    const persisted: HeroProgressionSnapshot = { ...snapshot, version: expectedVersion + 1 }

    this.byKey.set(key, persisted)

    return Promise.resolve(HeroProgression.restore(persisted))
  }
}
