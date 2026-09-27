import type { PlayerId } from '../../domain/value-objects/identifiers'

/**
 * Lectura minima del estado que pertenece al contexto de combate (HU-29).
 *
 * Player/Inventory no crea batallas ni interpreta su ciclo de vida. Solo
 * pregunta si el heroe de un jugador esta participando en una batalla activa
 * antes de delegar la escritura al flujo de HU-28.
 */
export interface BattleStatePort {
  isHeroInActiveBattle(ownerId: PlayerId, heroId: string): Promise<boolean>
}

export const BATTLE_STATE = Symbol('BattleStatePort')
