import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Put,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  ArmorCapacityExceededError,
  EquipmentSlotOccupiedError,
  InvalidEquipmentSlotError,
  ItemAlreadyEquippedError,
  ItemCapacityExceededError,
  WeaponCapacityExceededError,
} from '../../../domain/entities/HeroLoadout'
import {
  EquipmentProductNotOwnedError,
  EquipmentSlotMismatchError,
  HeroLoadoutConflictError,
  HeroNotOwnedError,
  InvalidEquipmentTypeError,
} from '../../../application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../../application/ports/CatalogReadPort'
import type { HeroEquipmentDto } from '../../../application/dto/HeroEquipmentDto'
import type { EquipItemOnHero } from '../../../application/use-cases/EquipItemOnHero'
import type { GetHeroEquipment } from '../../../application/use-cases/GetHeroEquipment'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { EQUIP_ITEM_ON_HERO, GET_HERO_EQUIPMENT } from './tokens'
import { CurrentIdentity } from './auth/decorators'
import { EquipItemRequest, HeroEquipmentResponse } from './hero-equipment.dto'

/**
 * Configuracion de equipamiento de un heroe propio (HU-28, RF-28).
 *
 * La identidad del jugador sale EXCLUSIVAMENTE del sujeto verificado del
 * testimonio. La ruta no acepta `ownerId` en ningun sitio, y el `heroId` de la
 * URL identifica el recurso pero su pertenencia se comprueba contra el sujeto:
 * no hay identificador manipulable con el que tocar el heroe de otra persona.
 * Un heroe o producto ajenos responden 404 (anti-enumeracion), igual que el
 * resto del servicio.
 *
 * Este controlador es el UNICO punto de equipamiento. HU-29 podra anteponer un
 * guard de estado de batalla sin duplicar el proceso.
 */
@ApiTags('hero-equipment')
@ApiBearerAuth()
@Controller('inventories/me/heroes')
export class HeroEquipmentController {
  constructor(
    @Inject(GET_HERO_EQUIPMENT) private readonly getHeroEquipment: GetHeroEquipment,
    @Inject(EQUIP_ITEM_ON_HERO) private readonly equipItemOnHero: EquipItemOnHero,
  ) {}

  @Get(':heroId/equipment')
  @ApiOperation({
    summary: 'Configuracion de equipamiento del heroe propio, con estadisticas efectivas',
  })
  @ApiResponse({ status: 200, type: HeroEquipmentResponse })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'El jugador no dispone de ese heroe' })
  @ApiResponse({ status: 503, description: 'Catalog no respondio' })
  async equipment(
    @Param('heroId') heroId: string,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<HeroEquipmentDto> {
    try {
      return await this.getHeroEquipment.execute(identity.subject, heroId)
    } catch (error: unknown) {
      throw HeroEquipmentController.translate(error)
    }
  }

  @Put(':heroId/equipment/:slot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Equipa un producto propio en una ranura exacta del heroe y devuelve el nuevo estado',
  })
  @ApiResponse({ status: 200, type: HeroEquipmentResponse })
  @ApiResponse({ status: 400, description: 'Ranura o cuerpo invalido' })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'Heroe o producto no propio' })
  @ApiResponse({
    status: 409,
    description: 'Ranura ocupada, capacidad 2/6/2 excedida o conflicto de concurrencia',
  })
  @ApiResponse({ status: 422, description: 'El producto no encaja en la familia o la ranura' })
  @ApiResponse({ status: 503, description: 'Catalog no respondio' })
  async equip(
    @Param('heroId') heroId: string,
    @Param('slot') slot: string,
    @Body() body: EquipItemRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<HeroEquipmentDto> {
    try {
      return await this.equipItemOnHero.execute({
        ownerId: identity.subject,
        heroReference: heroId,
        slot,
        productReference: body.productReference,
      })
    } catch (error: unknown) {
      throw HeroEquipmentController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof HeroNotOwnedError || error instanceof EquipmentProductNotOwnedError) {
      return new NotFoundException(error.message)
    }

    if (
      error instanceof InvalidEquipmentTypeError ||
      error instanceof EquipmentSlotMismatchError ||
      error instanceof InvalidEquipmentSlotError
    ) {
      return new UnprocessableEntityException(error.message)
    }

    if (
      error instanceof EquipmentSlotOccupiedError ||
      error instanceof ItemAlreadyEquippedError ||
      error instanceof WeaponCapacityExceededError ||
      error instanceof ArmorCapacityExceededError ||
      error instanceof ItemCapacityExceededError ||
      error instanceof HeroLoadoutConflictError
    ) {
      return new ConflictException(error.message)
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
