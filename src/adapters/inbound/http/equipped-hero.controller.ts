import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  HeroNotOwnedError,
  NoHeroSelectedError,
} from '../../../application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../../application/ports/CatalogReadPort'
import type { EquippedHeroDto } from '../../../application/dto/EquippedHeroDto'
import type { GetEquippedHeroForCombat } from '../../../application/use-cases/GetEquippedHeroForCombat'
import { GET_EQUIPPED_HERO_FOR_COMBAT } from './tokens'
import { InternalCallers, InternalOnly } from './auth/decorators'

/**
 * Contrato interno de solo lectura para que Combat obtenga el heroe
 * preparado/equipado del jugador (HU-15, RF-15, Management#24,
 * Management#392; resuelve el bloqueo DP-4 de
 * HU-15.2-Plan-Resolucion-Bloqueos-RF15).
 *
 * REUTILIZA EL MISMO PATRON YA REAL DE ESTE SERVICIO
 * (`ProductOwnersController`/`InternalServiceGuard`, HU-38): servicio-a-
 * servicio EXCLUSIVAMENTE, `@InternalOnly()` exime del testimonio JWT de
 * jugador y exige en su lugar la firma HMAC de `InternalServiceGuard` -el
 * MISMO mecanismo que ya protege `POST /internal/v1/inventory/grants` y
 * `GET /internal/v1/inventory/products/:productId/owners`, sin esquema
 * paralelo-. No se publica mediante el proxy publico (Caddy
 * `handle /api/internal* { respond 404 }` en Infrastructure).
 *
 * `:playerId` LO RELLENA COMBAT CON EL SUJETO DE SU PROPIO TESTIMONIO YA
 * VERIFICADO, nunca un cliente publico: esta ruta vive detras del contrato
 * interno, no del proxy publico, y ningun servicio publico (Web) la alcanza.
 * No se acepta `heroId` en ninguna parte: el heroe se resuelve por el
 * jugador, no al reves.
 *
 * NO ACCEDE A MONGO. Delega en `GetEquippedHeroForCombat`, que a su vez
 * delega COMPLETAMENTE en `GetHeroSelection` -el mismo caso de uso que sirve
 * `GET /inventories/me/heroes/selection` (HU-07)-. Una unica fuente de
 * verdad para "cual es el heroe preparado de un jugador".
 *
 * EL DTO DE RESPUESTA ES UN SUBCONJUNTO DELIBERADO (ver `EquippedHeroDto`):
 * ni imageUrl, ni lifecycleStatus, ni el detalle de cada ranura equipada, ni
 * la ocupacion de capacidad viajan aqui. Combat necesita identificar el
 * heroe y calcular con sus estadisticas, no el inventario completo del
 * jugador.
 *
 * `activeEffects` (HU-25) SI viaja, normalizado y sin el objeto crudo de
 * Catalog (`raw`): son los efectos que HU-28 ya calculo para este equipamiento.
 * Este endpoint los proyecta; no los recalcula ni define su semantica de
 * combate. Ver `docs/equipped-hero-contract.md`.
 *
 * NO EXISTE "nivel de heroe" EN ESTE DOMINIO (auditoria HU-15.2, hallazgo
 * DP-3, reconfirmado por grep exhaustivo al construir este contrato: no hay
 * `level`, `heroLevel`, `powerLevel` ni `experienceLevel` en ningun lugar del
 * modelo). Este contrato NO LO INVENTA. Si Combat necesita escalar por nivel,
 * es una decision de producto pendiente para HU-15.4 y queda fuera de este
 * contrato.
 */
@InternalOnly()
@InternalCallers('commerce', 'notifications', 'combat')
@ApiTags('internal-combat')
@Controller('internal/v1/players')
export class EquippedHeroController {
  constructor(
    @Inject(GET_EQUIPPED_HERO_FOR_COMBAT)
    private readonly getEquippedHero: GetEquippedHeroForCombat,
  ) {}

  @Get(':playerId/equipped-hero')
  @ApiOperation({
    summary: 'Heroe preparado/equipado del jugador, para Combat (servicio-a-servicio).',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({
    status: 401,
    description: 'Firma interna ausente, invalida, o servicio no permitido',
  })
  @ApiResponse({ status: 404, description: 'El jugador no ha preparado ningun heroe' })
  @ApiResponse({ status: 503, description: 'Catalog no respondio' })
  async equippedHero(@Param('playerId') playerId: string): Promise<EquippedHeroDto> {
    try {
      return await this.getEquippedHero.execute(playerId)
    } catch (error: unknown) {
      throw EquippedHeroController.translate(error)
    }
  }

  private static translate(error: unknown): Error {
    // Igual que HeroSelectionController: "sin heroe preparado" y "el heroe
    // salio del inventario" responden 404 por la misma politica
    // anti-enumeracion del resto del servicio.
    if (error instanceof HeroNotOwnedError || error instanceof NoHeroSelectedError) {
      return new NotFoundException(error.message)
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
