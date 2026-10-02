import { TransferBattleDrop } from '../../src/application/use-cases/TransferBattleDrop'
import { DomainError } from '../../src/domain/errors/DomainError'

const VALID_OPERATION_ID = '11111111-1111-4111-8111-111111111111'

const command = (overrides: Record<string, unknown> = {}) => ({
  operationId: VALID_OPERATION_ID,
  battleId: 'battle-1',
  defeatEventSeq: 1,
  sourcePlayerId: 'jugador-b',
  targetPlayerId: 'jugador-a',
  productInstanceId: 'unidad-1',
  ...overrides,
})

describe('TransferBattleDrop (HU-30)', () => {
  const build = () => {
    const transfer = jest.fn().mockResolvedValue({
      ...command(),
      productId: 'p',
      itemId: 'i',
      creditedAt: '2026-10-01T00:00:00.000Z',
    })
    return { transfer, useCase: new TransferBattleDrop({ transfer }) }
  }

  it('operationId no UUID se rechaza antes de tocar el puerto', () => {
    const { useCase, transfer } = build()

    expect(() => useCase.execute(command({ operationId: 'no-es-un-uuid' }))).toThrow(DomainError)
    expect(transfer).not.toHaveBeenCalled()
  })

  it.each(['battleId', 'sourcePlayerId', 'targetPlayerId', 'productInstanceId'])(
    '%s en blanco se rechaza antes de tocar el puerto',
    (field) => {
      const { useCase, transfer } = build()

      expect(() => useCase.execute(command({ [field]: '  ' }))).toThrow(DomainError)
      expect(transfer).not.toHaveBeenCalled()
    },
  )

  it('origen y destino iguales se rechaza', () => {
    const { useCase, transfer } = build()

    expect(() =>
      useCase.execute(command({ sourcePlayerId: 'jugador-a', targetPlayerId: 'jugador-a' })),
    ).toThrow(DomainError)
    expect(transfer).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5])('defeatEventSeq %s invalido se rechaza', (defeatEventSeq) => {
    const { useCase, transfer } = build()

    expect(() => useCase.execute(command({ defeatEventSeq }))).toThrow(DomainError)
    expect(transfer).not.toHaveBeenCalled()
  })

  it('con un comando valido, delega exactamente ese comando al puerto', async () => {
    const { useCase, transfer } = build()
    const input = command()

    const result = await useCase.execute(input)

    expect(transfer).toHaveBeenCalledWith(input)
    expect(result.productInstanceId).toBe('unidad-1')
  })
})
