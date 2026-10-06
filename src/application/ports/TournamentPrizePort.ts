/** Contrato aditivo HU-86; Tournament posee la elegibilidad del campeon/final. */
export interface TournamentPrizeCommand {
  readonly operationId: string
  readonly tournamentId: string
  readonly championTeamId: string
  readonly finalEncounterId: string
  readonly finalRoomId: string
  readonly playerId: string
  readonly heroId: string
  readonly kind: 'EPIC'
  readonly amount: null
  readonly productId: string
}

export interface TournamentPrizeReceipt extends TournamentPrizeCommand {
  readonly status: 'DELIVERED'
  readonly receiptId: string
}

export class TournamentPrizeError extends Error {
  constructor(
    readonly code:
      'SCHEMA_INVALID' | 'OPERATION_ID_REUSED' | 'PRIZE_INVALID' | 'PRIZE_DEPENDENCY_UNAVAILABLE',
    readonly status: 400 | 409 | 422 | 503,
    message: string,
  ) {
    super(message)
    this.name = 'TournamentPrizeError'
  }
}

export interface TournamentPrizePort {
  /** Busca antes de Catalog: un replay confirmado no revalida datos cambiantes. */
  find(command: TournamentPrizeCommand): Promise<TournamentPrizeReceipt | null>
  /** Recomprueba pertenencia y confirma unidad + registro global + recibo atomicamente. */
  grant(command: TournamentPrizeCommand, ownedHeroItemId: string): Promise<TournamentPrizeReceipt>
}

/** Orden estable y proposito del servidor; nunca recibe actor/purpose del consumidor. */
export const tournamentPrizeFingerprint = (c: TournamentPrizeCommand): string =>
  JSON.stringify({
    consumer: 'tournament',
    purpose: 'TOURNAMENT_EPIC_PRIZE',
    operationId: c.operationId,
    tournamentId: c.tournamentId,
    championTeamId: c.championTeamId,
    finalEncounterId: c.finalEncounterId,
    finalRoomId: c.finalRoomId,
    playerId: c.playerId,
    heroId: c.heroId,
    kind: c.kind,
    amount: c.amount,
    productId: c.productId,
  })

export const TOURNAMENT_PRIZES = Symbol('TournamentPrizePort')
