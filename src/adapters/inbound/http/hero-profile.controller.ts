import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import { HeroNotOwnedError } from '../../../application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../../application/ports/CatalogReadPort'
import type { HeroProfileDto } from '../../../application/dto/HeroProfileDto'
import type { GetHeroProfileForMission } from '../../../application/use-cases/GetHeroProfileForMission'
import { InternalCallers, InternalOnly } from './auth/decorators'
import { GET_HERO_PROFILE_FOR_MISSION } from './tokens'

/**
 * Perfil de un heroe concreto del jugador, para el contrato interno de Missions
 * (HU-71, Management#56/#370).
 *
 * SERVICIO A SERVICIO, NUNCA AL CLIENTE. `@InternalOnly()` exime del testimonio
 * JWT de jugador y exige la firma HMAC de `InternalServiceGuard`; y
 * `@InternalCallers('missions')` acota el permiso a ESTA ruta. La lista global de
 * servicios de Player/Inventory (`commerce`, `notifications`, `combat`) **no se
 * amplia**: `missions` no entra en ella ni falta que haga. Es el mismo mecanismo
 * de minimo privilegio que ya usa la acreditacion de experiencia de HU-09.
 *
 * ES RUTA HERMANA DE `equipped-hero`, NO SU SUSTITUTA. Aquella sigue sirviendo
 * al heroe SELECCIONADO para Combat y no se toca; esta sirve a CUALQUIER heroe
 * del jugador, porque el heroe de una estrategia de rotaciones no tiene por que
 * ser el que tiene preparado.
 *
 * `playerId` Y `heroId` VAN EN LA RUTA, no en la consulta: quien llama es un
 * servicio autenticado por HMAC -- no hay identificador que un cliente publico
 * pueda elegir -- y la firma interna cubre la ruta **sin** la cadena de consulta.
 *
 * `{heroId}` es el `productId` canonico del heroe y la respuesta devuelve ese
 * mismo `heroId`. El consumidor (Missions) compara el campo con el que envio.
 *
 * `404` LLEVA `code: HERO_NOT_OWNED`, y no es un adorno: el consumidor solo
 * acepta el `404` como «el heroe no es de ese jugador» si el cuerpo trae ese
 * codigo. Cualquier otro `404` -- el de una ruta inexistente, por ejemplo -- lo
 * trata como un resultado desconocido y **no** guarda la estrategia. Por eso este
 * controlador no reutiliza el `translate` de la ruta de Combat, que responde el
 * `404` sin codigo.
 */
@ApiTags('internal-missions')
@ApiHeader({ name: 'x-internal-service', required: true, description: 'Siempre `missions`.' })
@ApiHeader({ name: 'x-internal-timestamp', required: true })
@ApiHeader({ name: 'x-internal-signature', required: true })
@InternalOnly()
@InternalCallers('missions')
@Controller('internal/v1/players')
export class HeroProfileController {
  constructor(
    @Inject(GET_HERO_PROFILE_FOR_MISSION)
    private readonly getHeroProfile: GetHeroProfileForMission,
  ) {}

  @Get(':playerId/heroes/:heroId')
  @ApiOperation({
    summary: 'Perfil y habilidades de un heroe del jugador, para Missions (servicio-a-servicio).',
  })
  @ApiResponse({ status: 200, description: 'Perfil del heroe, con sus habilidades y su loadout.' })
  @ApiResponse({
    status: 401,
    description: 'Firma interna ausente o invalida, o servicio distinto de `missions`',
  })
  @ApiResponse({
    status: 404,
    description: 'El heroe no es del jugador (`code: HERO_NOT_OWNED`), no existe o no es un HEROE',
  })
  @ApiResponse({ status: 503, description: 'Catalog no respondio' })
  async heroProfile(
    @Param('playerId') playerId: string,
    @Param('heroId') heroId: string,
  ): Promise<HeroProfileDto> {
    try {
      return await this.getHeroProfile.execute(playerId, heroId)
    } catch (error: unknown) {
      throw HeroProfileController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    // El `code` es parte del contrato: sin el, quien llama no puede distinguir
    // «el heroe no es suyo» de «esa ruta no existe».
    if (error instanceof HeroNotOwnedError) {
      return new NotFoundException({ code: 'HERO_NOT_OWNED', message: error.message })
    }

    if (error instanceof CatalogUnavailableError) {
      return new ServiceUnavailableException(
        'La informacion del catalogo no esta disponible en este momento. Intentelo de nuevo mas tarde.',
      )
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error instanceof Error ? error : new Error('Fallo desconocido del servicio.')
  }
}
