import { GetProductOwners } from '../../src/application/use-cases/GetProductOwners'
import { GrantPurchasedItems } from '../../src/application/use-cases/GrantPurchasedItems'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { DomainError } from '../../src/domain/errors/DomainError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'

const PRODUCT_A = '11111111-1111-4111-8111-111111111111'
const PRODUCT_B = '22222222-2222-4222-8222-222222222222'

describe('Resolucion de propietarios por producto (HU-38, TASK #175)', () => {
  it('un producto sin propietarios devuelve una lista vacia', async () => {
    const repository = new InMemoryInventoryRepository()
    const useCase = new GetProductOwners(repository)

    const result = await useCase.execute(PRODUCT_A)

    expect(result).toEqual({ productId: PRODUCT_A, owners: [] })
  })

  it('un unico propietario aparece una sola vez', async () => {
    const repository = new InMemoryInventoryRepository()
    const grant = new GrantPurchasedItems(repository)
    await grant.execute({
      operationId: '33333333-3333-4333-8333-333333333333',
      playerId: 'jugador-a',
      items: [{ productId: PRODUCT_A, quantity: 1 }],
    })

    const result = await new GetProductOwners(repository).execute(PRODUCT_A)

    expect(result.owners).toEqual([{ playerId: 'jugador-a' }])
  })

  it('multiples propietarios distintos aparecen todos', async () => {
    const repository = new InMemoryInventoryRepository()
    const grant = new GrantPurchasedItems(repository)
    await grant.execute({
      operationId: '33333333-3333-4333-8333-333333333333',
      playerId: 'jugador-a',
      items: [{ productId: PRODUCT_A, quantity: 1 }],
    })
    await grant.execute({
      operationId: '44444444-4444-4444-8444-444444444444',
      playerId: 'jugador-b',
      items: [{ productId: PRODUCT_A, quantity: 3 }],
    })

    const result = await new GetProductOwners(repository).execute(PRODUCT_A)

    expect(result.owners.map((owner) => owner.playerId).sort()).toEqual(['jugador-a', 'jugador-b'])
  })

  it('un jugador con varias unidades no se duplica', async () => {
    const repository = new InMemoryInventoryRepository()
    const grant = new GrantPurchasedItems(repository)
    await grant.execute({
      operationId: '33333333-3333-4333-8333-333333333333',
      playerId: 'jugador-a',
      items: [{ productId: PRODUCT_A, quantity: 1 }],
    })
    // Segunda entrega, misma operacion distinta: unidades adicionales del mismo producto.
    await grant.execute({
      operationId: '55555555-5555-4555-8555-555555555555',
      playerId: 'jugador-a',
      items: [{ productId: PRODUCT_A, quantity: 4 }],
    })

    const result = await new GetProductOwners(repository).execute(PRODUCT_A)

    expect(result.owners).toEqual([{ playerId: 'jugador-a' }])
  })

  it('un producto diferente no aparece en el resultado', async () => {
    const repository = new InMemoryInventoryRepository()
    const grant = new GrantPurchasedItems(repository)
    await grant.execute({
      operationId: '33333333-3333-4333-8333-333333333333',
      playerId: 'jugador-a',
      items: [{ productId: PRODUCT_A, quantity: 1 }],
    })

    const result = await new GetProductOwners(repository).execute(PRODUCT_B)

    expect(result.owners).toEqual([])
  })

  it('la consulta no modifica el inventario', async () => {
    const repository = new InMemoryInventoryRepository()
    const grant = new GrantPurchasedItems(repository)
    await grant.execute({
      operationId: '33333333-3333-4333-8333-333333333333',
      playerId: 'jugador-a',
      items: [{ productId: PRODUCT_A, quantity: 1 }],
    })

    await new GetProductOwners(repository).execute(PRODUCT_A)
    await new GetProductOwners(repository).execute(PRODUCT_A)

    const snapshot = (await repository.findByOwner(PlayerId.create('jugador-a')))?.toSnapshot()
    expect(snapshot?.slots).toEqual([{ itemId: PRODUCT_A, quantity: 1 }])
  })

  it('un productId invalido responde con un DomainError controlado, no una lista vacia silenciosa', async () => {
    const useCase = new GetProductOwners(new InMemoryInventoryRepository())

    await expect(useCase.execute('  ')).rejects.toBeInstanceOf(DomainError)
    await expect(useCase.execute('MAYUSCULAS INVALIDAS!!')).rejects.toBeInstanceOf(DomainError)
  })
})
