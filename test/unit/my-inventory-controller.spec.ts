import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'

import { MyInventoryController } from '../../src/adapters/inbound/http/my-inventory.controller'
import { ListOwnedItemsQuery } from '../../src/adapters/inbound/http/my-inventory.dto'
import type { ListOwnedInventoryItems } from '../../src/application/use-cases/ListOwnedInventoryItems'
import type { GetOwnedInventoryItemDetail } from '../../src/application/use-cases/GetOwnedInventoryItemDetail'
import type { PagedInventoryItemsDto } from '../../src/application/dto/PagedInventoryItemsDto'
import type { OwnedInventoryItemDetailDto } from '../../src/application/dto/OwnedInventoryItemDetailDto'
import type { VerifiedIdentity } from '../../src/application/ports/TokenVerifierPort'
import { Role } from '../../src/application/ports/TokenVerifierPort'
import { InventoryItemNotFoundError } from '../../src/application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'
import { DomainError } from '../../src/domain/errors/DomainError'

const identity = (subject: string): VerifiedIdentity => ({
  subject,
  email: null,
  roles: new Set([Role.Player]),
})

const query = (fields: Partial<ListOwnedItemsQuery> = {}): ListOwnedItemsQuery =>
  Object.assign(new ListOwnedItemsQuery(), { page: 1, ...fields })

const build = (
  list: Partial<ListOwnedInventoryItems> = {},
  detail: Partial<GetOwnedInventoryItemDetail> = {},
): MyInventoryController =>
  new MyInventoryController(list as ListOwnedInventoryItems, detail as GetOwnedInventoryItemDetail)

describe('MyInventoryController — listado', () => {
  it('delega con el sujeto del testimonio, la página, la búsqueda y el filtro', async () => {
    const page: PagedInventoryItemsDto = {
      items: [{ itemId: 'espada', quantity: 1, product: null }],
      page: 1,
      pageSize: 16,
      totalItems: 1,
      totalPages: 1,
    }
    const execute = jest.fn().mockResolvedValue(page)
    const controller = build({ execute })

    const result = await controller.items(query({ q: 'espada', type: 'ARMA' }), identity('s-1'))

    expect(execute).toHaveBeenCalledWith({
      ownerId: 's-1',
      page: 1,
      query: 'espada',
      type: 'ARMA',
    })
    expect(result).toBe(page)
  })

  it('traduce un error de dominio a 400', async () => {
    const execute = jest.fn().mockRejectedValue(new DomainError('página inválida'))
    const controller = build({ execute })

    await expect(controller.items(query(), identity('s-1'))).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('traduce CatalogUnavailableError a 503', async () => {
    const execute = jest.fn().mockRejectedValue(new CatalogUnavailableError('timeout'))
    const controller = build({ execute })

    await expect(controller.items(query({ q: 'espada' }), identity('s-1'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('propaga cualquier otro error sin convertirlo', async () => {
    const fallo = new Error('mongo caído')
    const execute = jest.fn().mockRejectedValue(fallo)
    const controller = build({ execute })

    await expect(controller.items(query(), identity('s-1'))).rejects.toBe(fallo)
  })
})

describe('MyInventoryController — detalle', () => {
  const detailDto: OwnedInventoryItemDetailDto = {
    itemId: 'espada',
    quantity: 2,
    product: {
      productId: 'pid-1',
      sku: 'espada',
      name: 'Espada',
      imageUrl: 'https://x/espada.png',
      description: 'Una espada',
      type: 'ARMA',
      lifecycleStatus: 'ACTIVE',
      creditsPrice: 40,
      premium: false,
      realMoneyPrice: null,
      attributes: { schemaVersion: '1' },
    },
  }

  it('delega con el sujeto del testimonio y la referencia', async () => {
    const execute = jest.fn().mockResolvedValue(detailDto)
    const controller = build({}, { execute })

    const result = await controller.itemDetail('espada', identity('s-1'))

    expect(execute).toHaveBeenCalledWith('s-1', 'espada')
    expect(result).toBe(detailDto)
  })

  it('traduce InventoryItemNotFoundError a 404', async () => {
    const execute = jest.fn().mockRejectedValue(new InventoryItemNotFoundError('espada'))
    const controller = build({}, { execute })

    await expect(controller.itemDetail('espada', identity('s-1'))).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('traduce CatalogUnavailableError a 503', async () => {
    const execute = jest.fn().mockRejectedValue(new CatalogUnavailableError('5xx'))
    const controller = build({}, { execute })

    await expect(controller.itemDetail('espada', identity('s-1'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })
})
