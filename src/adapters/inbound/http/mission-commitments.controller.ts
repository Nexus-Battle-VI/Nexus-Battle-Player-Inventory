import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Body,
  ServiceUnavailableException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import { CatalogUnavailableError } from '../../../application/ports/CatalogReadPort'
import {
  CommitHeroForMission,
  MissionCommitmentRejectionError,
} from '../../../application/use-cases/CommitHeroForMission'
import {
  HeroCommittedError,
  MissionCommitmentConcurrentError,
  MissionCommitmentConflictError,
} from '../../../application/ports/MissionHeroCommitmentPort'
import { InternalCallers, InternalOnly } from './auth/decorators'
import { CreateMissionCommitmentRequest } from './mission-commitments.dto'
import { COMMIT_HERO_FOR_MISSION } from './tokens'

@ApiTags('internal-missions')
@ApiHeader({ name: 'x-internal-service', required: true, description: 'missions' })
@ApiHeader({ name: 'x-internal-timestamp', required: true })
@ApiHeader({ name: 'x-internal-signature', required: true })
@InternalOnly()
@InternalCallers('missions')
@Controller('internal/v1/inventory')
export class MissionCommitmentsController {
  constructor(@Inject(COMMIT_HERO_FOR_MISSION) private readonly useCase: CommitHeroForMission) {}

  @Post('heroes/:heroId/commitments')
  @HttpCode(201)
  @ApiOperation({ summary: 'Reservar un heroe propio para una mision' })
  @ApiResponse({ status: 201, description: 'Compromiso activo o repeticion idempotente' })
  @ApiResponse({ status: 422, description: 'Heroe no propio, no listo, incompleto u ocupado' })
  async commit(@Param('heroId') heroId: string, @Body() body: CreateMissionCommitmentRequest) {
    try {
      const commitment = await this.useCase.execute({
        operationId: body.operationId,
        playerId: body.playerId,
        heroId,
        reference: body.reference,
        expiresAt: new Date(body.expiresAt),
        completeLoadout: body.requirements.completeLoadout,
      })
      return {
        commitmentId: commitment.commitmentId,
        heroId: commitment.heroId,
        purpose: 'MISSION',
        reference: commitment.reference,
        expiresAt: commitment.expiresAt.toISOString(),
      }
    } catch (error: unknown) {
      throw MissionCommitmentsController.translate(error)
    }
  }

  @Post('commitments/:operationId/release')
  @HttpCode(204)
  @ApiOperation({ summary: 'Liberar idempotentemente un compromiso de mision' })
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
    if (error instanceof MissionCommitmentRejectionError) {
      return new UnprocessableEntityException({
        code: error.code,
        message: error.message,
        ...error.detail,
      })
    }
    if (error instanceof HeroCommittedError) {
      return new UnprocessableEntityException({
        code: 'HERO_COMMITTED',
        purpose: error.purpose,
        message: error.message,
      })
    }
    if (error instanceof MissionCommitmentConflictError) {
      return new ConflictException({ code: 'OPERATION_ID_REUSED', message: error.message })
    }
    if (
      error instanceof MissionCommitmentConcurrentError ||
      error instanceof CatalogUnavailableError
    ) {
      return new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: error.message,
      })
    }
    if (error instanceof DomainError) return new BadRequestException(error.message)
    return new ServiceUnavailableException(
      'No se pudo confirmar la reserva. Reintente la misma operacion.',
    )
  }
}
