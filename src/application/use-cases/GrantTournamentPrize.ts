import { DomainError } from '../../domain/errors/DomainError'
import { parseEpicAttributes } from '../../domain/policies/hero-epic-effects'
import { PlayerId } from '../../domain/value-objects/identifiers'
import { HeroNotOwnedError } from '../errors/ApplicationError'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import {
  TournamentPrizeError,
  type TournamentPrizeCommand,
  type TournamentPrizePort,
  type TournamentPrizeReceipt,
} from '../ports/TournamentPrizePort'
import { resolveOwnedHero } from './hero-equipment-shared'

const limits = {
  operationId: 512,
  tournamentId: 160,
  championTeamId: 160,
  finalEncounterId: 512,
  finalRoomId: 160,
  playerId: 160,
  heroId: 160,
  productId: 160,
} as const

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}

/** DTO estricto tambien para consumidores de aplicacion que no pasan por HTTP. */
export const normalizeTournamentPrize = (raw: unknown): TournamentPrizeCommand => {
  const invalid = (): never => {
    throw new TournamentPrizeError(
      'SCHEMA_INVALID',
      400,
      'Se requieren los diez campos canonicos del derecho EPIC, con amount:null.',
    )
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return invalid()
  const c = raw as Record<string, unknown>
  const keys = [...Object.keys(limits), 'kind', 'amount']
  if (Object.keys(c).length !== keys.length || Object.keys(c).some((k) => !keys.includes(k)))
    return invalid()
  for (const [field, max] of Object.entries(limits)) {
    const value = c[field]
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > max ||
      value.trim() !== value ||
      hasControlCharacter(value)
    )
      return invalid()
  }
  if (c.kind !== 'EPIC' || c.amount !== null) return invalid()
  return {
    operationId: c.operationId as string,
    tournamentId: c.tournamentId as string,
    championTeamId: c.championTeamId as string,
    finalEncounterId: c.finalEncounterId as string,
    finalRoomId: c.finalRoomId as string,
    playerId: c.playerId as string,
    heroId: c.heroId as string,
    kind: 'EPIC',
    amount: null,
    productId: c.productId as string,
  }
}

export class GrantTournamentPrize {
  constructor(
    private readonly prizes: TournamentPrizePort,
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
  ) {}

  async execute(raw: unknown): Promise<TournamentPrizeReceipt> {
    const command = normalizeTournamentPrize(raw)
    try {
      const previous = await this.prizes.find(command)
      if (previous !== null) return previous
      const hero = await resolveOwnedHero(
        { inventories: this.inventories, catalog: this.catalog },
        PlayerId.create(command.playerId),
        command.heroId,
      )
      const epic = await this.catalog.getByReference(command.productId)
      if (
        hero.heroProduct.productId !== command.heroId ||
        epic?.productId !== command.productId ||
        epic.type !== 'EPICA' ||
        epic.lifecycleStatus !== 'ACTIVE'
      ) {
        throw new TournamentPrizeError(
          'PRIZE_INVALID',
          422,
          'Se requiere un heroe propio y una EPICA activa por sus productId canonicos.',
        )
      }
      const definition = parseEpicAttributes(epic.attributes)
      if (definition.associatedHeroType !== hero.heroView.heroSubtype) {
        throw new TournamentPrizeError(
          'PRIZE_INVALID',
          422,
          'La epica de premio no es compatible con el subtipo del heroe destinatario.',
        )
      }
      return await this.prizes.grant(command, hero.ownedItemId)
    } catch (error: unknown) {
      if (error instanceof TournamentPrizeError) throw error
      if (error instanceof HeroNotOwnedError || error instanceof DomainError) {
        throw new TournamentPrizeError(
          'PRIZE_INVALID',
          422,
          'El heroe, propiedad o definicion de Catalog no son validos para este premio.',
        )
      }
      throw new TournamentPrizeError(
        'PRIZE_DEPENDENCY_UNAVAILABLE',
        503,
        'No se pudo confirmar el premio. Reintente el mismo derecho y operationId.',
      )
    }
  }
}

export const GRANT_TOURNAMENT_PRIZE = Symbol('GrantTournamentPrize')
