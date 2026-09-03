import { GrantPurchasedItems } from '../../src/application/use-cases/GrantPurchasedItems'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import {
  InventoryGrantConflictError,
  InventoryGrantRejectedError,
} from '../../src/application/ports/InventoryGrantPort'
import { PlayerId, ItemId, Quantity } from '../../src/domain/value-objects/identifiers'
import { Inventory } from '../../src/domain/entities/Inventory'

const productId = '11111111-1111-4111-8111-111111111111'
const command = {
  operationId: '22222222-2222-4222-8222-222222222222',
  playerId: 'player-a',
  items: [{ productId, quantity: 2 }],
}

describe('Entrega de compras', () => {
  it('entrega un lote canonico una vez y conserva el resultado al repetir', async () => {
    const repository = new InMemoryInventoryRepository()
    const useCase = new GrantPurchasedItems(repository)
    const [first, second] = await Promise.all([useCase.execute(command), useCase.execute(command)])
    expect(second).toEqual(first)
    expect(first.applied).toBe(true)
    const inventory = await repository.findByOwner(PlayerId.create(command.playerId))
    expect(inventory?.toSnapshot().slots).toEqual([{ itemId: productId, quantity: 2 }])
  })

  it('rechaza la reutilizacion de una operacion para otro jugador o cantidad', async () => {
    const useCase = new GrantPurchasedItems(new InMemoryInventoryRepository())
    await useCase.execute(command)
    await expect(useCase.execute({ ...command, playerId: 'player-b' })).rejects.toBeInstanceOf(
      InventoryGrantConflictError,
    )
    await expect(
      useCase.execute({ ...command, items: [{ productId, quantity: 3 }] }),
    ).rejects.toBeInstanceOf(InventoryGrantConflictError)
  })

  it('rechaza referencias legacy, productos duplicados y cantidades invalidas', () => {
    const useCase = new GrantPurchasedItems(new InMemoryInventoryRepository())
    expect(() =>
      useCase.execute({ ...command, items: [{ productId: 'espada', quantity: 1 }] }),
    ).toThrow()
    expect(() =>
      useCase.execute({ ...command, items: [...command.items, ...command.items] }),
    ).toThrow()
    expect(() => useCase.execute({ ...command, items: [{ productId, quantity: 0 }] })).toThrow()
    expect(() => useCase.execute({ ...command, items: [] })).toThrow()
  })

  it('conserva un rechazo terminal incluso si despues se libera espacio', async () => {
    const repository = new InMemoryInventoryRepository()
    const ownerId = PlayerId.create(command.playerId)
    await repository.save(
      Inventory.restore({ ownerId, capacity: 1, slots: [{ itemId: 'ocupado', quantity: 1 }] }),
    )
    const useCase = new GrantPurchasedItems(repository)
    const outcomes = await Promise.allSettled([useCase.execute(command), useCase.execute(command)])
    expect(
      outcomes.every(
        (outcome) =>
          outcome.status === 'rejected' && outcome.reason instanceof InventoryGrantRejectedError,
      ),
    ).toBe(true)
    const inventory = (await repository.findByOwner(ownerId))!
    inventory.remove(ItemId.create('ocupado'), Quantity.create(1), new Date())
    await repository.save(inventory)
    await expect(useCase.execute(command)).rejects.toBeInstanceOf(InventoryGrantRejectedError)
    expect((await repository.findByOwner(ownerId))?.usedSlots).toBe(0)
    await expect(
      useCase.execute({ ...command, operationId: '33333333-3333-4333-8333-333333333333' }),
    ).resolves.toMatchObject({ applied: true })
  })
})
