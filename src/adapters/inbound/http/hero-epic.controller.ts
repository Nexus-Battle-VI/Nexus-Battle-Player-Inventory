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
import { LOGGER, type Logger } from '../../../infrastructure/observability/logger'
import {
  EpicProductInvalidTypeError,
  EpicProductNotOwnedError,
  EquipmentLockedDuringBattleError,
  HeroEpicSelectionConflictError,
  HeroNotOwnedError,
} from '../../../application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../../application/ports/CatalogReadPort'
import type { HeroEpicDto } from '../../../application/dto/HeroEpicDto'
import type { EquipEpicOnHero } from '../../../application/use-cases/EquipEpicOnHero'
import type { GetHeroEpic } from '../../../application/use-cases/GetHeroEpic'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { EQUIP_EPIC_ON_HERO, GET_HERO_EPIC } from './tokens'
import { CurrentIdentity } from './auth/decorators'
import { EquipEpicRequest, HeroEpicResponse } from './hero-epic.dto'

/**
 * `GET/PUT /api/inventories/me/heroes/:heroId/epic` (HU-31, contrato
 * `hu-31-equipped-epic-v1` §11). Mismo patron que `HeroEquipmentController`
 * (HU-28): auth por testimonio verificado, heroe en la URL, identidad nunca
 * en el cuerpo.
 */
@ApiTags('hero-epic')
@ApiBearerAuth()
@Controller('inventories/me/heroes')
export class HeroEpicController {
  constructor(
    @Inject(GET_HERO_EPIC) private readonly getHeroEpic: GetHeroEpic,
    @Inject(EQUIP_EPIC_ON_HERO) private readonly equipEpicOnHero: EquipEpicOnHero,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Get(':heroId/epic')
  @ApiOperation({ summary: 'Epica equipada del heroe propio.' })
  @ApiResponse({ status: 200, type: HeroEpicResponse })
  async epic(
    @Param('heroId') heroId: string,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<HeroEpicDto> {
    try {
      return await this.getHeroEpic.execute(identity.subject, heroId)
    } catch (error: unknown) {
      throw HeroEpicController.translate(error)
    }
  }

  @Put(':heroId/epic')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Equipa (o reemplaza) la habilidad epica del heroe propio.' })
  @ApiResponse({ status: 200, type: HeroEpicResponse })
  @ApiResponse({ status: 404, description: 'Heroe o epica no propios' })
  @ApiResponse({ status: 409, description: 'Bloqueo de batalla o conflicto de version' })
  @ApiResponse({ status: 422, description: 'El producto no es una epica' })
  async equip(
    @Param('heroId') heroId: string,
    @Body() body: EquipEpicRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<HeroEpicDto> {
    try {
      const view = await this.equipEpicOnHero.execute({
        ownerId: identity.subject,
        heroReference: heroId,
        productReference: body.productReference,
      })
      this.logger.info('epic_equip_applied', { playerId: identity.subject, heroId })
      return view
    } catch (error: unknown) {
      if (error instanceof EquipmentLockedDuringBattleError) {
        this.logger.warn('epic_equip_rejected', {
          reason: error.reason,
          playerId: identity.subject,
          heroId,
        })
      }
      throw HeroEpicController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof HeroNotOwnedError || error instanceof EpicProductNotOwnedError) {
      return new NotFoundException(error.message)
    }
    if (error instanceof EpicProductInvalidTypeError) {
      return new UnprocessableEntityException(error.message)
    }
    if (error instanceof EquipmentLockedDuringBattleError) {
      return new ConflictException({ reason: error.reason, message: error.message })
    }
    if (error instanceof HeroEpicSelectionConflictError) {
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
