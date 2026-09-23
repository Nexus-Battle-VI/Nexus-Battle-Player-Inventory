import type { Config } from 'jest'

/**
 * Jest sobre CommonJS, que es el formato de salida del Nest CLI 11.
 * La transformacion la realiza ts-jest con TypeScript 5.9.
 */
const shared = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
} as const

const config: Config = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
    },
  ],
  // El adaptador de MongoDB y su infraestructura quedan fuera porque los mide
  // `jest.db.config.ts`, que si levanta un motor real. Contarlos aqui como no
  // cubiertos seria enganoso: no distinguiria lo que no se prueba de lo que se
  // prueba en otro sitio. Entre las dos configuraciones no queda codigo sin
  // medir.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/demo/**',
    '!src/**/*.module.ts',
    '!src/**/index.ts',
    '!src/main.ts',
    '!src/adapters/outbound/persistence/MongoInventoryRepository.ts',
    '!src/adapters/outbound/persistence/MongoHeroLoadoutRepository.ts',
    '!src/adapters/outbound/persistence/MongoHeroProgressionRepository.ts',
    '!src/infrastructure/persistence/**',
  ],
  coverageDirectory: 'coverage',
  // `json` es el detalle por linea: sin el, `json-summary` da porcentajes pero
  // no permite saber QUE linea quedo sin cubrir, que es lo que hace falta para
  // no anadir pruebas triviales solo para subir un numero (Task #190, punto 7).
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'json'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
}

export default config
