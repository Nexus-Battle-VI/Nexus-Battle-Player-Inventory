import { InMemoryHeroProgressionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroProgressionRepository'
import { HeroProgression } from '../../src/domain/entities/HeroProgression'
import { HeroProgressionConflictError } from '../../src/application/errors/ApplicationError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'

/**
 * Doble en memoria de la progresion (HU-08, Task #189).
 *
 * Reproduce el bloqueo optimista de MongoDB para que las pruebas de los casos de
 * uso puedan ejercitar el conflicto sin contenedor, igual que su hermano de
 * loadout.
 */
describe('InMemoryHeroProgressionRepository', () => {
  it('devuelve null cuando el heroe no tiene progresion, sin crearla', async () => {
    const repo = new InMemoryHeroProgressionRepository()

    expect(await repo.findByHero(PlayerId.create('jugador-1'), 'heroe-1')).toBeNull()
    // La segunda lectura sigue siendo null: no se sembro nada.
    expect(await repo.findByHero(PlayerId.create('jugador-1'), 'heroe-1')).toBeNull()
  })

  it('guarda y relee la progresion con la version incrementada', async () => {
    const repo = new InMemoryHeroProgressionRepository()
    const progression = HeroProgression.createEmpty('jugador-1', 'heroe-1')

    const saved = await repo.save(progression, 0)
    expect(saved.version).toBe(1)

    const persisted = await repo.findByHero(PlayerId.create('jugador-1'), 'heroe-1')
    expect(persisted?.level.value).toBe(1)
    expect(persisted?.experience.currentXp).toBe(0)
    expect(persisted?.version).toBe(1)
  })

  it('aísla por heroe: el progreso de uno no toca el de otro del mismo jugador', async () => {
    const repo = new InMemoryHeroProgressionRepository()
    const owner = PlayerId.create('jugador-1')

    const a = HeroProgression.createEmpty('jugador-1', 'heroe-a')
    const b = HeroProgression.createEmpty('jugador-1', 'heroe-b')

    await repo.save(a, 0)
    await repo.save(b, 0)

    expect((await repo.findByHero(owner, 'heroe-a'))?.version).toBe(1)
    expect((await repo.findByHero(owner, 'heroe-b'))?.version).toBe(1)
  })

  it('aísla por jugador: la misma referencia de heroe no se mezcla entre jugadores', async () => {
    const repo = new InMemoryHeroProgressionRepository()

    await repo.save(HeroProgression.createEmpty('jugador-1', 'heroe-1'), 0)

    expect(await repo.findByHero(PlayerId.create('jugador-2'), 'heroe-1')).toBeNull()
  })

  it('rechaza un guardado cuya version esperada ya no coincide', async () => {
    const repo = new InMemoryHeroProgressionRepository()
    await repo.save(HeroProgression.createEmpty('jugador-2', 'heroe-2'), 0)

    await expect(
      repo.save(HeroProgression.createEmpty('jugador-2', 'heroe-2'), 0),
    ).rejects.toBeInstanceOf(HeroProgressionConflictError)
  })

  it('acepta el guardado cuando la version esperada si coincide', async () => {
    const repo = new InMemoryHeroProgressionRepository()
    const first = await repo.save(HeroProgression.createEmpty('jugador-3', 'heroe-3'), 0)

    const progression = HeroProgression.restore({ ...first.toSnapshot() })
    const second = await repo.save(progression, 1)

    expect(second.version).toBe(2)
  })
})
