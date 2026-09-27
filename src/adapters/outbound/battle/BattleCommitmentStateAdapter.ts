import type { PlayerId } from '../../../domain/value-objects/identifiers'
import type { BattleHeroCommitmentPort } from '../../../application/ports/BattleHeroCommitmentPort'
import type { BattleStatePort } from '../../../application/ports/BattleStatePort'
import type { ClockPort } from '../../../application/ports/ClockPort'

/**
 * Adaptador REAL del estado de batalla (HU-29).
 *
 * Responde a la unica pregunta que hace la regla de bloqueo --«¿participa este
 * heroe en una batalla activa?»-- leyendo el **compromiso de batalla** que Combat
 * publica al iniciar y libera al terminar (`ADR-019`, contrato
 * `hu-29-battle-commitment-v1`).
 *
 * POR QUE NO CONSULTA A COMBAT. Player/Inventory no pregunta al vecino en el
 * camino critico del equipamiento: lee un dato que ya es suyo, que es exactamente
 * el motivo por el que `ADR-019` eligio «compromiso publicado» y no «consulta
 * sincrona al contexto de combate».
 *
 * Un compromiso vencido NO bloquea: la caducidad es la red que impide un bloqueo
 * permanente si la liberacion se pierde.
 */
export class BattleCommitmentStateAdapter implements BattleStatePort {
  constructor(
    private readonly commitments: BattleHeroCommitmentPort,
    private readonly clock: ClockPort,
  ) {}

  isHeroInActiveBattle(ownerId: PlayerId, heroId: string): Promise<boolean> {
    return this.commitments.hasActiveForHero(ownerId.value, heroId, this.clock.now())
  }
}
