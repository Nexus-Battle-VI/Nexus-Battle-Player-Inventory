import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'
import { HeroLoadoutConflictError } from '../../src/application/errors/ApplicationError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'

const AT = new Date('2026-09-03T00:00:00.000Z')

const withWeapon = (owner: string, hero: string, itemId: string): HeroLoadout => {
  const loadout = HeroLoadout.createEmpty(owner, hero)
  loadout.equip({
    slot: 'WEAPON_1',
    itemId,
    productId: `pid-${itemId}`,
    category: 'WEAPON',
    occurredAt: AT,
  })
  return loadout
}

describe('InMemoryHeroLoadoutRepository', () => {
  it('guarda una instantanea, no el agregado vivo: una mutacion sin guardar no se filtra', async () => {
    const repo = new InMemoryHeroLoadoutRepository()
    const owner = PlayerId.create('jugador-1')
    const loadout = withWeapon('jugador-1', 'heroe-1', 'espada')

    const saved = await repo.save(loadout, 0)
    expect(saved.version).toBe(1)

    loadout.equip({
      slot: 'HELMET',
      itemId: 'casco',
      productId: 'pid-casco',
      category: 'ARMOR',
      occurredAt: AT,
    })

    const persisted = await repo.findByHero(owner, 'heroe-1')
    expect(persisted?.entry('HELMET')).toBeUndefined()
    expect(persisted?.version).toBe(1)
  })

  it('devuelve null cuando el heroe no tiene loadout', async () => {
    const repo = new InMemoryHeroLoadoutRepository()
    expect(await repo.findByHero(PlayerId.create('x'), 'sin-loadout')).toBeNull()
  })

  it('rechaza un guardado cuya version esperada ya no coincide', async () => {
    const repo = new InMemoryHeroLoadoutRepository()
    await repo.save(withWeapon('jugador-2', 'heroe-2', 'espada'), 0)

    await expect(repo.save(withWeapon('jugador-2', 'heroe-2', 'hacha'), 0)).rejects.toBeInstanceOf(
      HeroLoadoutConflictError,
    )
  })
})
