import type { CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import type { TournamentPrizeCommand } from '../../src/application/ports/TournamentPrizePort'

/** Dataset QA-HU86-INVENTORY-v1: fixtures; no productos ni campeon operativos. */
export const QA_HERO_ID = '86000000-0000-4000-8000-000000000001'
export const QA_EPIC_ID = '86000000-0000-4000-8000-000000000002'
export const qaProduct = (
  productId: string,
  type: string,
  values: Record<string, unknown>,
): CatalogProductView => ({
  productId,
  sku: type === 'HEROE' ? 'qa-hu86-mago' : 'qa-hu86-epica',
  name: `QA HU86 ${type}`,
  imageUrl: 'https://assets.example.test/qa.png',
  description: 'Fixture QA; excluida del producto.',
  type,
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: { schemaVersion: '1', values: { kind: type, ...values } },
})
export const qaHero = qaProduct(QA_HERO_ID, 'HEROE', {
  heroSubtype: 'MAGO_FUEGO',
  basePower: 5,
  baseHealth: 40,
  baseDefense: 8,
  baseAttack: { mode: 'FIXED', amount: 10 },
  baseDamage: { mode: 'FIXED', amount: 4 },
  abilities: [],
})
export const qaEpic = qaProduct(QA_EPIC_ID, 'EPICA', {
  compatibleHeroSubtype: 'MAGO_FUEGO',
  specificEffect: {
    kind: 'STAT_MODIFIER',
    target: 'SELF',
    statistic: 'DEFENSE',
    operation: 'INCREASE',
    magnitude: { mode: 'FIXED', amount: 4 },
    stackable: false,
  },
  powerCost: 0,
  cooldownTurns: 2,
})
export const qaCommand = (operationId = 'qa-hu86:epic:0'): TournamentPrizeCommand => ({
  operationId,
  tournamentId: 'qa-hu86-tournament',
  championTeamId: 'qa-hu86-team',
  finalEncounterId: 'qa-hu86-final',
  finalRoomId: 'qa-hu86-room',
  playerId: 'qa-hu86-player',
  heroId: QA_HERO_ID,
  kind: 'EPIC',
  amount: null,
  productId: QA_EPIC_ID,
})
