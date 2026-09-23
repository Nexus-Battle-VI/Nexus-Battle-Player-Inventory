import { HeroLoadout, type HeroLoadoutSnapshot } from '../../../domain/entities/HeroLoadout'
import type { PlayerId } from '../../../domain/value-objects/identifiers'
import { HeroLoadoutConflictError } from '../../../application/errors/ApplicationError'
import type { HeroLoadoutRepositoryPort } from '../../../application/ports/HeroLoadoutRepositoryPort'
import type {
  MissionHeroCommitmentPort,
  MissionHeroCommitment,
  MissionHeroCommitmentInput,
} from '../../../application/ports/MissionHeroCommitmentPort'
import {
  HeroCommittedError,
  MissionCommitmentConcurrentError,
  MissionCommitmentConflictError,
  sameMissionCommitment,
} from '../../../application/ports/MissionHeroCommitmentPort'
import { randomUUID } from 'node:crypto'

/**
 * Repositorio en memoria del loadout de heroe.
 *
 * Almacena instantaneas, no el agregado vivo: una mutacion sin guardar no se
 * filtra al almacen. Reproduce el bloqueo optimista de MongoDB comparando la
 * version esperada con la almacenada, para que las pruebas de los casos de uso
 * ejerciten el conflicto sin contenedor.
 */
export class InMemoryHeroLoadoutRepository
  implements HeroLoadoutRepositoryPort, MissionHeroCommitmentPort
{
  private readonly byKey = new Map<string, HeroLoadoutSnapshot>()
  private readonly commitments = new Map<string, MissionHeroCommitment>()
  private readonly activeByHero = new Map<string, string>()

  private static key(ownerId: string, heroId: string): string {
    return `${ownerId}::${heroId}`
  }

  findByHero(ownerId: PlayerId, heroId: string): Promise<HeroLoadout | null> {
    const snapshot = this.byKey.get(InMemoryHeroLoadoutRepository.key(ownerId.value, heroId))

    return Promise.resolve(snapshot === undefined ? null : HeroLoadout.restore(snapshot))
  }

  save(loadout: HeroLoadout, expectedVersion: number): Promise<HeroLoadout> {
    const key = InMemoryHeroLoadoutRepository.key(loadout.ownerId, loadout.heroId)
    const activeOperation = this.activeByHero.get(key)
    const active = activeOperation === undefined ? null : this.commitments.get(activeOperation)
    if (active?.status === 'ACTIVE' && active.expiresAt.getTime() > Date.now()) {
      return Promise.reject(new HeroCommittedError())
    }
    const current = this.byKey.get(key)
    const storedVersion = current?.version ?? 0

    if (storedVersion !== expectedVersion) {
      return Promise.reject(new HeroLoadoutConflictError(loadout.heroId))
    }

    const snapshot = loadout.toSnapshot()
    const nextVersion = expectedVersion + 1
    const persisted: HeroLoadoutSnapshot = { ...snapshot, version: nextVersion }

    this.byKey.set(key, persisted)
    // Se drenan los eventos: el almacen es el limite de la transaccion logica.
    loadout.pullEvents()

    return Promise.resolve(HeroLoadout.restore(persisted))
  }

  findByOperation(operationId: string): Promise<MissionHeroCommitment | null> {
    const commitment = this.commitments.get(operationId)
    return Promise.resolve(commitment === undefined ? null : structuredClone(commitment))
  }

  commit(
    input: MissionHeroCommitmentInput,
    expectedLoadoutVersion: number,
  ): Promise<MissionHeroCommitment> {
    const previous = this.commitments.get(input.operationId)
    if (previous !== undefined) {
      if (
        !sameMissionCommitment(previous, input) ||
        previous.status !== 'ACTIVE' ||
        previous.expiresAt.getTime() <= Date.now()
      ) {
        return Promise.reject(new MissionCommitmentConflictError())
      }
      return Promise.resolve(structuredClone(previous))
    }

    const key = InMemoryHeroLoadoutRepository.key(input.playerId, input.heroId)
    const activeOperation = this.activeByHero.get(key)
    const active = activeOperation === undefined ? null : this.commitments.get(activeOperation)
    if (active?.status === 'ACTIVE' && active.expiresAt.getTime() > Date.now()) {
      return Promise.reject(new HeroCommittedError())
    }
    const actualVersion = this.byKey.get(key)?.version ?? 0
    if (actualVersion !== expectedLoadoutVersion) {
      return Promise.reject(new MissionCommitmentConcurrentError())
    }

    const commitment: MissionHeroCommitment = {
      ...input,
      commitmentId: randomUUID(),
      status: 'ACTIVE',
    }
    this.commitments.set(input.operationId, structuredClone(commitment))
    this.activeByHero.set(key, input.operationId)
    return Promise.resolve(structuredClone(commitment))
  }

  release(operationId: string): Promise<void> {
    const previous = this.commitments.get(operationId)
    if (previous === undefined || previous.status === 'RELEASED') return Promise.resolve()
    this.commitments.set(operationId, { ...previous, status: 'RELEASED' })
    const key = InMemoryHeroLoadoutRepository.key(previous.playerId, previous.heroId)
    if (this.activeByHero.get(key) === operationId) this.activeByHero.delete(key)
    return Promise.resolve()
  }
}
