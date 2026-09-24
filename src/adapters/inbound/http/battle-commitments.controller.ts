import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
  Body,
} from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  BattleCommitmentConflictError,
  BattleHeroCommittedError,
} from '../../../application/ports/BattleHeroCommitmentPort'
import {
  BattleCommitmentRejectionError,
  CommitHeroForBattle,
} from '../../../application/use-cases/CommitHeroForBattle'
import { InternalCallers, InternalOnly } from './auth/decorators'
import { CreateBattleCommitmentRequest } from './battle-commitments.dto'
import { COMMIT_HERO_FOR_BATTLE } from './tokens'

/**
 * Compromiso de batalla del heroe (HU-29, contrato `hu-29-battle-commitment-v1`).
 *
 * ES LO QUE HACE REAL EL BLOQUEO. Combat compromete cada heroe participante al
 * iniciar la batalla y lo libera al terminar; mientras el compromiso este
 * vigente, el loadout del heroe queda bloqueado. Sin esta llamada, la regla de
 * HU-29 existiria y nunca se dispararia.
 *
 * SERVICIO A SERVICIO, NUNCA AL CLIENTE: `@InternalOnly()` exime del testimonio y
 * `@InternalCallers('combat')` acota el permiso a ESTAS DOS RUTAS. La lista
 * global de Player/Inventory ya contiene `combat`, asi que no se amplia ningun
 * permiso.
 *
 * RUTA HERMANA, NO AMPLIACION: el compromiso de mision vive en
 * `.../heroes/:heroId/commitments` y esta acotado a `missions`. Reutilizarlo
 * habria abierto la ruta de mision a `combat`.
 */
@ApiTags('internal-combat')
@ApiHeader({ name: 'x-internal-service', required: true, description: 'combat' })
@ApiHeader({ name: 'x-internal-timestamp', required: true })
@ApiHeader({ name: 'x-internal-signature', required: true })
@InternalOnly()
@InternalCallers('combat')
@Controller('internal/v1/inventory')
export class BattleCommitmentsController {
  constructor(@Inject(COMMIT_HERO_FOR_BATTLE) private readonly useCase: CommitHeroForBattle) {}

  @Post('heroes/:heroId/battle-commitments')
  @HttpCode(201)
  @ApiOperation({ summary: 'Comprometer un heroe propio para una batalla' })
  @ApiResponse({ status: 201, description: 'Compromiso activo o repeticion idempotente' })
  @ApiResponse({ status: 409, description: 'El operationId se reutilizo con otro contenido' })
  @ApiResponse({ status: 422, description: 'Heroe no propio, o ya esta en otra batalla' })
  async commit(
    @Param('heroId') heroId: string,
    @Body() body: CreateBattleCommitmentRequest,
  ): Promise<Record<string, unknown>> {
    try {
      const commitment = await this.useCase.execute({
        operationId: body.operationId,
        playerId: body.playerId,
        heroId,
        reference: body.reference,
        expiresAt: new Date(body.expiresAt),
      })

      return {
        commitmentId: commitment.commitmentId,
        heroId: commitment.heroId,
        purpose: 'BATTLE',
        reference: commitment.reference,
        expiresAt: commitment.expiresAt.toISOString(),
      }
    } catch (error: unknown) {
      throw BattleCommitmentsController.translate(error)
    }
  }

  @Post('battle-commitments/:operationId/release')
  @HttpCode(204)
  @ApiOperation({ summary: 'Liberar idempotentemente un compromiso de batalla' })
  @ApiResponse({ status: 204, description: 'Liberado o ya ausente' })
  async release(@Param('operationId') operationId: string): Promise<void> {
    try {
      await this.useCase.release(operationId)
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo confirmar la liberacion. Reintente con la misma operacion.',
      )
    }
  }

  private static translate(error: unknown): Error {
    if (error instanceof BattleCommitmentRejectionError) {
      return new UnprocessableEntityException({
        code: error.code,
        message: error.message,
        ...error.detail,
      })
    }

    if (error instanceof BattleHeroCommittedError) {
      return new UnprocessableEntityException({
        code: 'HERO_COMMITTED',
        message: error.message,
      })
    }

    if (error instanceof BattleCommitmentConflictError) {
      return new ConflictException({ code: 'OPERATION_ID_REUSED', message: error.message })
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return new ServiceUnavailableException(
      'No se pudo confirmar la reserva. Reintente la misma operacion.',
    )
  }
}
