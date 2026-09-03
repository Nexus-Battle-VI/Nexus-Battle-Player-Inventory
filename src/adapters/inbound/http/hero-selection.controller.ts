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
  Put,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  HeroNotOwnedError,
  HeroNotSelectableError,
  HeroSelectionConflictError,
  NoHeroSelectedError,
} from '../../../application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../../application/ports/CatalogReadPort'
import type { AvailableHeroDto, HeroSelectionDto } from '../../../application/dto/HeroSelectionDto'
import type { GetHeroSelection } from '../../../application/use-cases/GetHeroSelection'
import type { ListAvailableHeroes } from '../../../application/use-cases/ListAvailableHeroes'
import type { SelectHero } from '../../../application/use-cases/SelectHero'
import type { VerifiedIdentity } from '../../../application/ports/TokenVerifierPort'
import { GET_HERO_SELECTION, LIST_AVAILABLE_HEROES, SELECT_HERO } from './tokens'
import { CurrentIdentity } from './auth/decorators'
import {
  AvailableHeroResponse,
  HeroSelectionResponse,
  SelectHeroRequest,
} from './hero-selection.dto'

/**
 * Seleccion y preparacion del heroe propio (HU-07, RF-07).
 *
 * LA IDENTIDAD SALE EXCLUSIVAMENTE DEL SUJETO VERIFICADO DEL TESTIMONIO. Ni la
 * URL, ni la query, ni el cuerpo aceptan `ownerId`: no existe un identificador
 * manipulable con el que ver o cambiar la preparacion de otra persona. Es la
 * misma politica que el resto del servicio, y es lo que hace del aislamiento
 * entre jugadores una propiedad de la ruta y no una comprobacion que se pueda
 * olvidar.
 *
 * `selection` es un segmento LITERAL y no colisiona con `:heroId/equipment` de
 * `HeroEquipmentController`: tienen distinto numero de segmentos.
 *
 * ESTE CONTROLADOR NO EQUIPA NADA. Equipar sigue siendo de HU-28 y vive en su
 * propia ruta; duplicarla aqui daria dos caminos para la misma escritura.
 */
@ApiTags('hero-selection')
@ApiBearerAuth()
@Controller('inventories/me/heroes')
export class HeroSelectionController {
  constructor(
    @Inject(LIST_AVAILABLE_HEROES) private readonly listAvailableHeroes: ListAvailableHeroes,
    @Inject(GET_HERO_SELECTION) private readonly getHeroSelection: GetHeroSelection,
    @Inject(SELECT_HERO) private readonly selectHero: SelectHero,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Heroes que el jugador puede preparar, del catalogo vigente cruzado con su inventario',
  })
  @ApiResponse({ status: 200, type: AvailableHeroResponse, isArray: true })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 503, description: 'Catalog no respondio' })
  async available(
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<readonly AvailableHeroDto[]> {
    try {
      return await this.listAvailableHeroes.execute(identity.subject)
    } catch (error: unknown) {
      throw HeroSelectionController.translate(error)
    }
  }

  @Get('selection')
  @ApiOperation({ summary: 'Configuracion preparada del jugador: heroe, equipamiento y estado' })
  @ApiResponse({ status: 200, type: HeroSelectionResponse })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'El jugador no ha preparado ningun heroe' })
  @ApiResponse({ status: 503, description: 'Catalog no respondio' })
  async current(@CurrentIdentity() identity: VerifiedIdentity): Promise<HeroSelectionDto> {
    try {
      return await this.getHeroSelection.execute(identity.subject)
    } catch (error: unknown) {
      throw HeroSelectionController.translate(error)
    }
  }

  @Put('selection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Prepara un heroe propio y devuelve su configuracion. Idempotente sobre el mismo heroe',
  })
  @ApiResponse({ status: 200, type: HeroSelectionResponse })
  @ApiResponse({ status: 400, description: 'Cuerpo invalido' })
  @ApiResponse({ status: 401, description: 'Falta el testimonio o no es valido' })
  @ApiResponse({ status: 404, description: 'El jugador no dispone de ese heroe' })
  @ApiResponse({
    status: 409,
    description: 'El heroe no esta activo en el catalogo, o hubo conflicto de concurrencia',
  })
  @ApiResponse({ status: 503, description: 'Catalog no respondio' })
  async select(
    @Body() body: SelectHeroRequest,
    @CurrentIdentity() identity: VerifiedIdentity,
  ): Promise<HeroSelectionDto> {
    try {
      return await this.selectHero.execute(identity.subject, body.heroReference)
    } catch (error: unknown) {
      throw HeroSelectionController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    // `HeroNotOwnedError` cubre a la vez "no lo tienes", "no existe" y "no es un
    // HEROE". Los tres responden 404 por la misma politica anti-enumeracion del
    // resto del servicio: distinguirlos revelaria que ese heroe existe en el
    // inventario de otra persona.
    if (error instanceof HeroNotOwnedError || error instanceof NoHeroSelectedError) {
      return new NotFoundException(error.message)
    }

    if (error instanceof HeroNotSelectableError || error instanceof HeroSelectionConflictError) {
      return new ConflictException(error.message)
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
