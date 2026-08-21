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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import { InventoryNotFoundError } from '../../../application/errors/ApplicationError'
import type {
  AddItemToInventory,
  GetInventory,
  RemoveItemFromInventory,
} from '../../../application/use-cases/InventoryUseCases'
import { ADD_ITEM, GET_INVENTORY, REMOVE_ITEM } from './tokens'
import { ChangeInventoryRequest, InventoryResponse } from './inventories.dto'

/**
 * Adaptador de entrada HTTP.
 *
 * Traduce entre el protocolo y los casos de uso: valida la forma de la
 * peticion, invoca el caso de uso y convierte los errores de dominio y de
 * aplicacion en codigos HTTP. No contiene reglas de negocio.
 */
@ApiTags('inventories')
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
  async findOne(@Param('ownerId') ownerId: string): Promise<InventoryResponse> {
    try {
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
  ): Promise<InventoryResponse> {
    try {
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
  ): Promise<InventoryResponse> {
    try {
      return await this.removeItem.execute({
        ownerId,
        itemId: body.itemId,
        quantity: body.quantity,
      })
    } catch (error: unknown) {
      throw InventoriesController.translate(error)
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
