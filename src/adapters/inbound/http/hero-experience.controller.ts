import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  ExperienceGrantConflictError,
  ExperienceGrantRejectedError,
  HeroProgressionConflictError,
} from '../../../application/errors/ApplicationError'
import type { GrantHeroExperienceResult } from '../../../application/ports/ExperienceGrantPort'
import { GrantHeroExperience } from '../../../application/use-cases/GrantHeroExperience'
import { InternalCallers, InternalOnly } from './auth/decorators'
import { HeroExperienceRequest, HeroExperienceResponse } from './hero-experience.dto'
import { GRANT_HERO_EXPERIENCE } from './tokens'

/**
 * Acreditacion de experiencia a un heroe (HU-09, Task HU-09.3;
 * `hu-09-experience-reward-v1` §7).
 *
 * SERVICIO A SERVICIO, NUNCA AL CLIENTE. `@InternalOnly()` exime del testimonio
 * JWT y `@InternalCallers('missions')` acota el permiso a ESTA ruta: la lista
 * global de servicios de Player/Inventory (`['commerce','notifications','combat']`)
 * NO incluye a Missions y **no se toca**. Es el permiso minimo suficiente y el
 * mecanismo por ruta que ya existe en este servicio.
 *
 * `playerId` y `heroId` viajan en la RUTA porque quien llama es un servicio
 * autenticado por HMAC: no hay ningun identificador que un cliente pueda elegir.
 *
 * SE INVOCA UNA VEZ POR DERROTA, con la clave de esa derrota. El caso de uso es
 * idempotente por `operationId`: un reintento devuelve el mismo resultado con
 * `applied: false` y NO vuelve a acreditar.
 */
@ApiTags('player-inventory-internal')
@ApiHeader({ name: 'x-internal-service', required: true, description: 'Siempre `missions`.' })
@ApiHeader({ name: 'x-internal-timestamp', required: true })
@ApiHeader({ name: 'x-internal-signature', required: true })
@InternalOnly()
@InternalCallers('missions')
@Controller('internal/v1/players/:playerId/heroes/:heroId/experience')
export class HeroExperienceController {
  constructor(
    @Inject(GRANT_HERO_EXPERIENCE) private readonly grantHeroExperience: GrantHeroExperience,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Acredita experiencia de una derrota al heroe, una sola vez por operationId (HU-09)',
    description:
      'El importe llega YA calculado y entero: la formula y su redondeo son de Missions. La ' +
      'acreditacion acumula sin restar, recalcula el nivel con la tabla vigente de HU-08 y deja ' +
      'ledger y progresion en la misma transaccion.',
  })
  @ApiOkResponse({ type: HeroExperienceResponse })
  async grant(
    @Param('playerId') playerId: string,
    @Param('heroId') heroId: string,
    @Body() body: HeroExperienceRequest,
  ): Promise<HeroExperienceResponse> {
    try {
      return toResponse(
        await this.grantHeroExperience.execute({
          schemaVersion: body.schemaVersion,
          operationId: body.operationId,
          playerId,
          heroId,
          amount: body.amount,
          source: body.source,
        }),
      )
    } catch (error: unknown) {
      throw HeroExperienceController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof ExperienceGrantConflictError) {
      return new ConflictException({
        code: 'EXPERIENCE_GRANT_CONFLICT',
        message: error.message,
      })
    }

    if (error instanceof ExperienceGrantRejectedError) {
      return new UnprocessableEntityException({
        code: 'EXPERIENCE_GRANT_REJECTED',
        message: error.message,
      })
    }

    // Cuerpo mal formado o fuera del contrato. El `code` es el del contrato §7 y
    // no el generico de Nest, para que Missions pueda distinguirlo.
    if (error instanceof DomainError) {
      return new BadRequestException({ code: 'SCHEMA_INVALID', message: error.message })
    }

    // Otra acreditacion del MISMO heroe gano la carrera de version. No es culpa
    // de quien llama y reintentar con el mismo `operationId` es seguro y
    // suficiente: es el `503` del contrato, no un 500.
    if (error instanceof HeroProgressionConflictError) {
      return new ServiceUnavailableException({
        code: 'PLAYER_INVENTORY_UNAVAILABLE',
        message: 'La progresion del heroe cambio durante la operacion. Reintente con la misma.',
      })
    }

    // Cualquier otro fallo -- y en particular la Base inalcanzable -- significa
    // "no se pudo atender ahora": Missions reintenta con el MISMO `operationId`,
    // que es lo que el contrato §7 manda. Mismo criterio que
    // `InventoryGrantsController`.
    return new ServiceUnavailableException({
      code: 'PLAYER_INVENTORY_UNAVAILABLE',
      message: 'No se pudo acreditar la experiencia. Reintente con la misma operacion.',
    })
  }
}

const toResponse = (result: GrantHeroExperienceResult): HeroExperienceResponse => ({
  operationId: result.operationId,
  applied: result.applied,
  heroId: result.heroId,
  level: result.level,
  currentXp: result.currentXp,
  leveledUp: result.leveledUp,
  levelsGained: result.levelsGained,
  // Derivados en la lectura con la tabla vigente de HU-08: no se persisten.
  nextLevel: result.nextLevel,
  maxLevel: result.maxLevel,
})
