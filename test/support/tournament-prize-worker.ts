import { MongoClient } from 'mongodb'
import { MongoTournamentPrizeRepository } from '../../src/adapters/outbound/persistence/MongoTournamentPrizeRepository'
import type { TournamentPrizeCommand } from '../../src/application/ports/TournamentPrizePort'

/** Proceso QA independiente: pool nuevo, coordinacion IPC, sin mock del motor. */
let execute: (() => Promise<void>) | undefined
process.on(
  'message',
  (message: {
    uri: string
    databaseName: string
    command: TournamentPrizeCommand
    heroItemId: string
    go?: boolean
  }) => {
    if (message.go) {
      void execute?.()
      return
    }
    void (async () => {
      const client = new MongoClient(message.uri, { maxPoolSize: 2 })
      await client.connect()
      execute = async () => {
        try {
          const receipt = await new MongoTournamentPrizeRepository(
            client.db(message.databaseName),
          ).grant(message.command, message.heroItemId)
          process.send?.({ receipt })
        } catch (error: unknown) {
          process.send?.({ error: error instanceof Error ? error.message : String(error) })
          process.exitCode = 1
        } finally {
          await client.close()
          process.disconnect()
        }
      }
      process.send?.({ ready: true })
    })().catch((error: unknown) => {
      process.send?.({ error: String(error) })
      process.exit(1)
    })
  },
)
