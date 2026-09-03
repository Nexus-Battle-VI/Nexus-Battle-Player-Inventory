import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import { InventoryItemNotFoundError } from '../../../application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../../application/ports/CatalogReadPort'
import type { ListOwnedInventoryItems } from '../../../application/use-cases/ListOwnedInventoryItems'
import type { GetOwnedInventoryItemDetail } from '../../../application/use-cases/GetOwnedInventoryItemDetail'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { GET_ITEM_DETAIL, LIST_OWNED_ITEMS } from './tokens'
import { CurrentIdentity } from './auth/decorators'
import {
  ListOwnedItemsQuery,
  OwnedInventoryItemDetailResponse,
  PagedInventoryItemsResponse,
} from './my-inventory.dto'

/**
 * Consulta self-service del inventario del jugador autenticado (HU-27, RF-27).
 *
 * La identidad sale EXCLUSIVAMENTE del sujeto verificado del testimonio. Esta
 * ruta no acepta `ownerId` ni en la URL ni en la query ni en el cuerpo, de modo
 * que no existe un identificador manipulable con el que leer el inventario de
 * otra persona. El endpoint heredado `GET /api/inventories/:ownerId` sigue
 * intacto y con su misma semantica.
 */
@ApiTags('inventories')
@ApiBearerAuth()
@Controller('inventories/me')
export class MyInventoryController {
  constructor(
    @Inject(LIST_OWNED_ITEMS) private readonly listOwnedItems: ListOwnedInventoryItems,
    @Inject(GET_ITEM_DETAIL) private readonly getItemDetail: GetOwnedInventoryItemDetail,
  ) {}

  @Get('items')
  @ApiOperation({
    summary: 'Consulta paginada del inventario propio (16 por pagina), con busqueda y filtro',
  })
  @ApiResponse({
    status: 200,
    description: 'Pagina del inventario del jugador autenticado',
    type: PagedInventoryItemsResponse,
  })
  @ApiResponse({ status: 400, description: 'Parametro de paginacion, busqueda o filtro invalido' })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({
    status: 503,
    description: 'La busqueda o el filtro necesitan Catalog y Catalog no respondio',
  })
  async items(
    @Query() query: ListOwnedItemsQuery,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<PagedInventoryItemsResponse> {
    try {
      return await this.listOwnedItems.execute({
        ownerId: identity.subject,
        page: query.page,
        query: query.q,
        type: query.type,
      })
    } catch (error: unknown) {
      throw MyInventoryController.translate(error)
    }
  }

  @Get('items/:itemReference')
  @ApiOperation({ summary: 'Ficha del producto poseido, con su informacion vigente de Catalog' })
  @ApiResponse({
    status: 200,
    description: 'Ficha compuesta del producto poseido',
    type: OwnedInventoryItemDetailResponse,
  })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'El jugador no posee esa referencia' })
  @ApiResponse({ status: 503, description: 'Catalog no respondio' })
  async itemDetail(
    @Param('itemReference') itemReference: string,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<OwnedInventoryItemDetailResponse> {
    try {
      return await this.getItemDetail.execute(identity.subject, itemReference)
    } catch (error: unknown) {
      throw MyInventoryController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof InventoryItemNotFoundError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof CatalogUnavailableError) {
      return new ServiceUnavailableException(
        'La informacion del producto no esta disponible en este momento. Intentelo de nuevo mas tarde.',
      )
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
