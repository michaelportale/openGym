// Maps an expo-sqlite database onto the { exec, run, getAll } handle the session storage takes.
// run keeps only { changes }: that is how a duplicate id (INSERT OR IGNORE) is told from a new row.
export function toSessionDbHandle(expoDb) {
  return {
    exec: sql => expoDb.execAsync(sql),
    async run(sql, params = []) {
      const { changes } = await expoDb.runAsync(sql, params)
      return { changes }
    },
    getAll: (sql, params = []) => expoDb.getAllAsync(sql, params),
  }
}
