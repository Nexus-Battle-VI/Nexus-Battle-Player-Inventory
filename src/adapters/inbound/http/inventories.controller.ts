import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import { InventoryNotFoundError } from '../../../application/errors/ApplicationError'
import type {
  AddItemToInventory,
  GetInventory,
  RemoveItemFromInventory,
} from '../../../application/use-cases/InventoryUseCases'
import { ADD_ITEM, GET_INVENTORY, REMOVE_ITEM } from './tokens'
import { ChangeInventoryRequest, InventoryResponse } from './inventories.dto'

import { Role, type VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { CurrentIdentity } from './auth/decorators'

/**
 * Adaptador de entrada HTTP.
 *
 * Traduce entre el protocolo y los casos de uso: valida la forma de la
 * peticion, invoca el caso de uso y convierte los errores de dominio y de
 * aplicacion en codigos HTTP. No contiene reglas de negocio.
 */
@ApiTags('inventories')
@ApiBearerAuth()
@Controller('inventories')
export class InventoriesController {
  constructor(
    @Inject(GET_INVENTORY) private readonly getInventory: GetInventory,
    @Inject(ADD_ITEM) private readonly addItem: AddItemToInventory,
    @Inject(REMOVE_ITEM) private readonly removeItem: RemoveItemFromInventory,
  ) {}

  @Get(':ownerId')
  @ApiOperation({ summary: 'Recupera el inventario de un jugador' })
  @ApiResponse({ status: 200, description: 'Inventario encontrado', type: InventoryResponse })
  @ApiResponse({ status: 404, description: 'El jugador no tiene inventario' })
  async findOne(
    @Param('ownerId') ownerId: string,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<InventoryResponse> {
    try {
      InventoriesController.assertOwner(ownerId, identity)

      return await this.getInventory.execute(ownerId)
    } catch (error: unknown) {
      throw InventoriesController.translate(error)
    }
  }

  @Post(':ownerId/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anade unidades de un objeto al inventario' })
  @ApiResponse({ status: 200, description: 'Inventario actualizado', type: InventoryResponse })
  @ApiResponse({ status: 400, description: 'Datos invalidos o inventario completo' })
  async add(
    @Param('ownerId') ownerId: string,
    @Body() body: ChangeInventoryRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<InventoryResponse> {
    try {
      InventoriesController.assertOwner(ownerId, identity)

      return await this.addItem.execute({ ownerId, itemId: body.itemId, quantity: body.quantity })
    } catch (error: unknown) {
      throw InventoriesController.translate(error)
    }
  }

  @Post(':ownerId/items/removals')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retira unidades de un objeto del inventario' })
  @ApiResponse({ status: 200, description: 'Inventario actualizado', type: InventoryResponse })
  @ApiResponse({ status: 400, description: 'Datos invalidos o unidades insuficientes' })
  @ApiResponse({ status: 404, description: 'El jugador no tiene inventario' })
  async remove(
    @Param('ownerId') ownerId: string,
    @Body() body: ChangeInventoryRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<InventoryResponse> {
    try {
      InventoriesController.assertOwner(ownerId, identity)

      return await this.removeItem.execute({
        ownerId,
        itemId: body.itemId,
        quantity: body.quantity,
      })
    } catch (error: unknown) {
      throw InventoriesController.translate(error)
    }
  }

  /**
   * El inventario de la URL debe ser el de quien pide.
   *
   * Antes bastaba cambiar el `ownerId` de la ruta para leer o vaciar el
   * inventario de cualquier jugador. El identificador sigue en la URL porque
   * identifica el recurso; lo que cambia es que ahora tiene que COINCIDIR con
   * el sujeto del testimonio.
   *
   * Un inventario ajeno responde 404 y no 403: distinguirlos confirmaria que
   * ese jugador existe, y con eso se puede enumerar quien juega. Un
   * administrador queda exento, y el super administrador satisface esa exigencia
   * de administrador de forma unidireccional, igual que resuelve `RolesGuard`:
   * un administrador NO hereda a la inversa lo que se exige al rol raiz.
   */
  private static assertOwner(ownerId: string, identity: VerifiedIdentity): void {
    const isAdmin =
      identity.roles.has(Role.Administrator) || identity.roles.has(Role.SuperAdministrator)

    if (ownerId !== identity.subject && !isAdmin) {
      throw new InventoryNotFoundError(ownerId)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof InventoryNotFoundError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
