import { openDatabaseAsync } from 'expo-sqlite'
import { toSessionDbHandle } from './db-handle.js'

// The only file that imports expo-sqlite. vitest cannot load the native module, so it has no test.
export const APP_DATABASE_NAME = 'opengym.db'

let opening = null

// One open per process. A failed open clears the memo so the next call can try again.
export function openAppDatabase() {
  if (!opening) {
    opening = openDatabaseAsync(APP_DATABASE_NAME).then(toSessionDbHandle).catch(error => {
      opening = null
      throw error
    })
  }
  return opening
}
