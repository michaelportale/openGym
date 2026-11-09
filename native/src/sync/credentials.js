// The sign-in token lives in the iOS Keychain and nowhere else: not in SQLite, not in a log.
// `secureStore` is the expo-secure-store module, injected so tests can pass a fake.

export const TOKEN_KEY = 'opengym.token'

export function createCredentials(secureStore) {
  // After the first unlock, so a background sync works with the phone locked; this device only,
  // so the token never travels in a backup to another phone.
  const options = { keychainAccessible: secureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }
  return {
    async get() {
      try {
        const token = await secureStore.getItemAsync(TOKEN_KEY, options)
        return token ? { token } : null
      } catch {
        // A locked or broken Keychain reads as unpaired. That is safe: the engine shows "Not paired"
        // and keeps all local data; nothing is deleted, and pairing again restores sync.
        return null
      }
    },
    async set({ token } = {}) {
      if (typeof token !== 'string' || !token) throw new Error('no token to save')
      await secureStore.setItemAsync(TOKEN_KEY, token, options)
    },
    async clear() {
      await secureStore.deleteItemAsync(TOKEN_KEY, options)
    },
  }
}
