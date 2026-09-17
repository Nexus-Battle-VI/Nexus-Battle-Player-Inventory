import { createInterface } from 'node:readline/promises'
import process from 'node:process'

import {
  getPower,
  regenPower,
  restorePower,
  spendPower,
  type HeroPowerCost,
  type HeroPowerState,
} from '../domain/policies/HeroPowerPolicy'
import type { HeroSubtype } from '../domain/value-objects/hero-subtype'

interface DemoAction {
  readonly name: string
  readonly cost: HeroPowerCost
}

interface DemoHero {
  readonly id: HeroSubtype
  readonly name: string
  readonly max: number
  readonly actions: readonly DemoAction[]
}

interface CommandResult {
  readonly hero: DemoHero
  readonly quit: boolean
}

const fixed = (amount: number): HeroPowerCost => ({ mode: 'FIXED', amount })

const heroes = [
  {
    id: 'GUERRERO_TANQUE',
    name: 'Guerrero Tanque',
    max: 10,
    actions: [
      { name: 'Golpe con escudo', cost: fixed(2) },
      { name: 'Mano de piedra', cost: fixed(4) },
      { name: 'Defensa feroz', cost: fixed(6) },
    ],
  },
  {
    id: 'GUERRERO_ARMAS',
    name: 'Guerrero Armas',
    max: 8,
    actions: [
      { name: 'Embate sangriento', cost: fixed(4) },
      { name: 'Lanza de los dioses', cost: fixed(4) },
      { name: 'Golpe de tormenta', cost: fixed(6) },
    ],
  },
  {
    id: 'MAGO_FUEGO',
    name: 'Mago Fuego',
    max: 8,
    actions: [
      { name: 'Misiles de magma', cost: fixed(2) },
      { name: 'Vulcano', cost: fixed(6) },
      { name: 'Pare de fuego', cost: fixed(4) },
    ],
  },
  {
    id: 'MAGO_HIELO',
    name: 'Mago Hielo',
    max: 10,
    actions: [
      { name: 'Lluvia de hielo', cost: fixed(2) },
      { name: 'Cono de hielo', cost: fixed(6) },
      { name: 'Bola de hielo', cost: fixed(4) },
    ],
  },
  {
    id: 'PICARO_VENENO',
    name: 'Pícaro Veneno',
    max: 8,
    actions: [
      { name: 'Flor de loto', cost: fixed(2) },
      { name: 'Agonía', cost: fixed(4) },
      { name: 'Piquete', cost: fixed(4) },
    ],
  },
  {
    id: 'PICARO_MACHETE',
    name: 'Pícaro Machete',
    max: 8,
    actions: [
      { name: 'Cortada', cost: fixed(2) },
      { name: 'Machetazo', cost: fixed(4) },
      { name: 'Planazo', cost: fixed(4) },
    ],
  },
  {
    id: 'CHAMAN',
    name: 'Chamán',
    max: 10,
    actions: [
      { name: 'Toque de la Vida', cost: fixed(2) },
      { name: 'Vínculo Natural', cost: fixed(4) },
      { name: 'Canto del Bosque', cost: fixed(6) },
    ],
  },
  {
    id: 'MEDICO',
    name: 'Médico',
    max: 10,
    actions: [
      { name: 'Curación Directa', cost: fixed(2) },
      { name: 'Neutralización de Efectos', cost: fixed(4) },
      { name: 'Reanimación', cost: { mode: 'ALL_AVAILABLE' } },
    ],
  },
] as const satisfies readonly DemoHero[]

const states = new Map<HeroSubtype, HeroPowerState>(
  heroes.map((hero) => [hero.id, { heroId: hero.id, current: hero.max, max: hero.max }]),
)

const write = (message = ''): void => {
  process.stdout.write(`${message}\n`)
}

const stateFor = (hero: DemoHero): HeroPowerState => {
  const state = states.get(hero.id)
  if (state === undefined) throw new Error(`No existe estado para ${hero.id}.`)
  return state
}

const costLabel = (cost: HeroPowerCost): string => {
  if (cost.mode === 'ALL_AVAILABLE') return 'todo el Poder disponible'
  if (cost.mode === 'NONE') return '0 Poder'
  return `${String(cost.amount)} Poder`
}

const showHero = (hero: DemoHero): void => {
  const state = stateFor(hero)
  write(`\n${hero.name} · Poder ${String(getPower(state))}/${String(state.max)}`)
  hero.actions.forEach((action, index) => {
    write(`${String(index + 1)}. ${action.name} (${costLabel(action.cost)})`)
  })
  write('b. Ataque básico   t. Pasar turno (+2)   c. Cancelar acción 1')
  write('e. Finalizar combate   h1..h8. Cambiar héroe   q. Salir')
}

const selectHero = (command: string, current: DemoHero): DemoHero => {
  const requested = Number(command.slice(1))
  return heroes[requested - 1] ?? current
}

const applyCommand = (command: string, hero: DemoHero): CommandResult => {
  if (/^h[1-8]$/u.test(command)) {
    const selected = selectHero(command, hero)
    write(`Héroe activo: ${selected.name}. Su Poder conservó su estado independiente.`)
    return { hero: selected, quit: false }
  }

  const state = stateFor(hero)
  if (command === 'q') return { hero, quit: true }

  if (command === 't') {
    const next = regenPower(state)
    states.set(hero.id, next)
    write(`Turno procesado: Poder ${String(next.current)}/${String(next.max)}.`)
    return { hero, quit: false }
  }

  if (command === 'e') {
    const next = restorePower(state)
    states.set(hero.id, next)
    write(`Combate finalizado: Poder restaurado a ${String(next.current)}/${String(next.max)}.`)
    return { hero, quit: false }
  }

  if (command === 'b') {
    const result = spendPower(state, { mode: 'NONE' })
    states.set(hero.id, result.state)
    write(`Ataque básico: Poder ${String(result.state.current)}/${String(result.state.max)}.`)
    return { hero, quit: false }
  }

  if (command === 'c') {
    const action = hero.actions[0]
    if (action === undefined) throw new Error(`El héroe ${hero.id} no tiene acciones.`)
    const result = spendPower(state, action.cost, 'CANCELLED')
    states.set(hero.id, result.state)
    write(`${action.name} fue cancelada: no se consumió Poder.`)
    return { hero, quit: false }
  }

  const actionIndex = Number(command) - 1
  const action = hero.actions[actionIndex]
  if (action === undefined) {
    write('Comando no reconocido.')
    return { hero, quit: false }
  }

  const result = spendPower(state, action.cost)
  states.set(hero.id, result.state)
  if (result.ok) {
    write(
      `${action.name}: consumió ${String(result.spent)}; Poder ${String(result.state.current)}/${String(result.state.max)}.`,
    )
  } else {
    write(`${action.name}: Poder insuficiente; se fuerza ataque básico sin consumo.`)
  }
  return { hero, quit: false }
}

const run = async (): Promise<void> => {
  const scriptedArgument = process.argv.find((argument) => argument.startsWith('--commands='))
  const scriptedCommands = scriptedArgument
    ?.slice('--commands='.length)
    .split(',')
    .map((value) => value.trim().toLowerCase())

  let activeHero: DemoHero = heroes[0]
  write('Nexus Battle · demo ejecutable HU-11 / RF-11')

  if (scriptedCommands !== undefined) {
    for (const command of scriptedCommands) {
      showHero(activeHero)
      write(`> ${command}`)
      const result = applyCommand(command, activeHero)
      activeHero = result.hero
      if (result.quit) break
    }
  } else {
    const terminal = createInterface({ input: process.stdin, output: process.stdout })
    try {
      let quit = false
      while (!quit) {
        showHero(activeHero)
        const command = (await terminal.question('> ')).trim().toLowerCase()
        const result = applyCommand(command, activeHero)
        activeHero = result.hero
        quit = result.quit
      }
    } finally {
      terminal.close()
    }
  }

  write('Demo finalizada.')
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
