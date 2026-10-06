import {
  Body,
  Catch,
  Controller,
  HttpCode,
  HttpException,
  Inject,
  Post,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common'
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface'
import {
  TournamentPrizeError,
  type TournamentPrizeReceipt,
} from '../../../application/ports/TournamentPrizePort'
import {
  GRANT_TOURNAMENT_PRIZE,
  GrantTournamentPrize,
} from '../../../application/use-cases/GrantTournamentPrize'
import { InternalCallers, InternalOnly } from './auth/decorators'

/** Envoltorio aditivo, incluyendo rechazos HMAC de guards; sin cambiar otras APIs. */
@Catch()
export class TournamentPrizeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const statusCode =
      error instanceof TournamentPrizeError
        ? error.status
        : error instanceof HttpException
          ? error.getStatus()
          : 503
    const code =
      error instanceof TournamentPrizeError
        ? error.code
        : statusCode === 401
          ? 'INTERNAL_UNAUTHORIZED'
          : statusCode === 400
            ? 'SCHEMA_INVALID'
            : 'PRIZE_DEPENDENCY_UNAVAILABLE'
    const message =
      error instanceof TournamentPrizeError
        ? error.message
        : statusCode === 401
          ? 'Peticion interna no autorizada.'
          : 'No se pudo confirmar el premio. Reintente el mismo derecho y operationId.'
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(statusCode)
      .json({ statusCode, code, message })
  }
}

const commandLimits: [string, number][] = [
  ['operationId', 512],
  ['tournamentId', 160],
  ['championTeamId', 160],
  ['finalEncounterId', 512],
  ['finalRoomId', 160],
  ['playerId', 160],
  ['heroId', 160],
  ['productId', 160],
]
const commandProperties = Object.fromEntries<SchemaObject>(
  commandLimits.map(([name, maxLength]): [string, SchemaObject] => [
    name,
    { type: 'string', minLength: 1, maxLength },
  ]),
)
const schema = {
  type: 'object',
  additionalProperties: false,
  required: [...Object.keys(commandProperties), 'kind', 'amount'],
  properties: {
    ...commandProperties,
    kind: { type: 'string', enum: ['EPIC'] },
    amount: { type: 'string', nullable: true, enum: [null] },
  },
}

@ApiTags('Tournament prizes')
@ApiSecurity('internal-hmac')
@ApiHeader({
  name: 'x-internal-service',
  required: true,
  description: 'Exclusivamente tournament.',
})
@ApiHeader({ name: 'x-internal-timestamp', required: true })
@ApiHeader({ name: 'x-internal-signature', required: true })
@InternalOnly()
@InternalCallers('tournament')
@UseFilters(TournamentPrizeExceptionFilter)
@Controller('internal/v1/inventory/tournament-prizes')
export class TournamentPrizesController {
  constructor(@Inject(GRANT_TOURNAMENT_PRIZE) private readonly grantPrize: GrantTournamentPrize) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'HU-86: una unidad EPICA y recibo durable, sin equipamiento automatico',
  })
  @ApiBody({ schema })
  @ApiOkResponse({
    schema: {
      ...schema,
      required: [...schema.required, 'status', 'receiptId'],
      properties: {
        ...schema.properties,
        status: { type: 'string', enum: ['DELIVERED'] },
        receiptId: { type: 'string', minLength: 1, maxLength: 160 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'SCHEMA_INVALID' })
  @ApiResponse({ status: 401, description: 'INTERNAL_UNAUTHORIZED' })
  @ApiResponse({ status: 409, description: 'OPERATION_ID_REUSED' })
  @ApiResponse({
    status: 422,
    description: 'PRIZE_INVALID: heroe, Catalog, compatibilidad o capacidad',
  })
  @ApiResponse({
    status: 503,
    description: 'PRIZE_DEPENDENCY_UNAVAILABLE; reintentar mismo operationId',
  })
  grant(@Body() body: unknown): Promise<TournamentPrizeReceipt> {
    return this.grantPrize.execute(body)
  }
}
