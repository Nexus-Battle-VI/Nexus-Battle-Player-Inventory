import { DomainError } from '../errors/DomainError'

export const POWER_REGEN_PER_TURN = 2 as const

export interface HeroPowerState {
  readonly heroId: string
  readonly current: number
  readonly max: number
}

export type HeroPowerCost =
  | { readonly mode: 'NONE' }
  | { readonly mode: 'FIXED'; readonly amount: number }
  | { readonly mode: 'ALL_AVAILABLE' }

export type PowerActionExecution = 'EXECUTED' | 'CANCELLED' | 'INVALID'

export type SpendPowerResult =
  | {
      readonly ok: true
      readonly spent: number
      readonly state: HeroPowerState
    }
  | {
      readonly ok: false
      readonly reason: 'insufficient' | 'not_executed'
      readonly fallbackAction: 'basic_attack' | null
      readonly spent: 0
      readonly state: HeroPowerState
    }

const validateInteger = (value: number, field: string): void => {
  if (!Number.isInteger(value)) {
    throw new DomainError(`${field} debe ser un entero. Se recibio ${String(value)}.`)
  }
}

export const validatePowerState = (state: HeroPowerState): HeroPowerState => {
  const heroId = state.heroId.trim()
  if (heroId.length === 0) {
    throw new DomainError('El Poder debe estar asociado a un heroe.')
  }

  validateInteger(state.max, 'El Poder maximo')
  validateInteger(state.current, 'El Poder actual')

  if (state.max < 0) {
    throw new DomainError('El Poder maximo no puede ser negativo.')
  }

  if (state.current < 0 || state.current > state.max) {
    throw new DomainError('El Poder actual debe estar entre cero y el maximo del heroe.')
  }

  return { ...state, heroId }
}

const powerAmount = (cost: unknown, state: HeroPowerState): number => {
  if (typeof cost !== 'object' || cost === null || !('mode' in cost)) {
    throw new DomainError('El costo de Poder debe declarar un modo valido.')
  }

  switch (cost.mode) {
    case 'NONE':
      return 0
    case 'ALL_AVAILABLE':
      return state.current
    case 'FIXED': {
      if (!('amount' in cost) || typeof cost.amount !== 'number') {
        throw new DomainError('El costo fijo de Poder debe declarar un monto numerico.')
      }
      validateInteger(cost.amount, 'El costo fijo de Poder')
      if (cost.amount <= 0) {
        throw new DomainError('El costo fijo de Poder debe ser mayor que cero.')
      }
      return cost.amount
    }
    default:
      throw new DomainError('El modo de costo de Poder no es valido.')
  }
}

const validateExecution = (execution: unknown): void => {
  if (execution !== 'EXECUTED' && execution !== 'CANCELLED' && execution !== 'INVALID') {
    throw new DomainError(`El estado de ejecucion "${String(execution)}" no es valido.`)
  }
}

export const getPower = (state: HeroPowerState): number => validatePowerState(state).current

/**
 * Resuelve el consumo una vez que el contexto de combate conoce el resultado
 * de la accion. Una accion cancelada o invalida nunca descuenta. Si una
 * habilidad fija es impagable, la seleccion se degrada al ataque basico sin
 * mutar el saldo. La funcion es pura: devuelve un estado nuevo.
 */
export const spendPower = (
  state: HeroPowerState,
  cost: HeroPowerCost,
  execution: PowerActionExecution = 'EXECUTED',
): SpendPowerResult => {
  const validState = validatePowerState(state)
  const amount = powerAmount(cost, validState)
  validateExecution(execution)

  if (execution !== 'EXECUTED') {
    return {
      ok: false,
      reason: 'not_executed',
      fallbackAction: null,
      spent: 0,
      state: validState,
    }
  }

  if (amount > validState.current) {
    return {
      ok: false,
      reason: 'insufficient',
      fallbackAction: 'basic_attack',
      spent: 0,
      state: validState,
    }
  }

  return {
    ok: true,
    spent: amount,
    state: { ...validState, current: validState.current - amount },
  }
}

/** Aplica la unica regeneracion definida por RF-11: +2 por turno. */
export const regenPower = (state: HeroPowerState): HeroPowerState => {
  const validState = validatePowerState(state)
  return {
    ...validState,
    current: Math.min(validState.max, validState.current + POWER_REGEN_PER_TURN),
  }
}

/** Restaura el recurso al maximo al finalizar cualquier combate. */
export const restorePower = (state: HeroPowerState): HeroPowerState => {
  const validState = validatePowerState(state)
  return { ...validState, current: validState.max }
}
