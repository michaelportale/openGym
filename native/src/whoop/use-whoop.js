import { useCallback, useRef, useState } from 'react'
import { Alert, AppState, Linking } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { coalesced } from '../body/coalesce'
import { announce } from '../plan/announce'
import { openAppDatabase } from '../storage/database'
import { createApiClient } from '../sync/api-client'
import { createCredentials } from '../sync/credentials'
import { createSqliteSyncMeta } from '../sync/server-copy'
import { useFocusReload } from '../sync/use-focus-reload'
import { createSqliteWhoopCache } from './whoop-cache'
import { createWhoopSource, isGoodRead } from './whoop-source'
import { WHOOP_TEXT } from './whoop-view'

// The one WHOOP source for the app, so its 10-minute window outlives the screen. A failed build
// is not remembered: the next call tries again.
let source = null

function getWhoopSource() {
  if (!source) {
    source = openAppDatabase()
      .then(db => {
        const meta = createSqliteSyncMeta(db)
        const credentials = createCredentials(SecureStore)
        return createWhoopSource({
          client: createApiClient({ fetch: (...args) => fetch(...args) }),
          cache: createSqliteWhoopCache(db),
          // Paired as the sync engine counts it: a token in the Keychain and a server address. The
          // profile id (stored at pairing) tells same-named profiles apart.
          pairing: async () => {
            const auth = await credentials.get()
            const base = await meta.get('server')
            return auth && base ? { base, token: auth.token, profileId: (await meta.get('profileId')) ?? '' } : null
          },
          now: Date.now,
        })
      })
      .catch(error => {
        source = null
        throw error
      })
  }
  return source
}

// { shown, busy, message, connect, disconnect }. `shown` is null until the first read, and again
// while another pairing's first read is out; otherwise whoop-source.js's { paired, payload, cached,
// savedAt? } for whoop-view.js. Reads on focus, on every sync or
// Health emit (a pairing made or forgotten), and when the app comes back while the tab is focused
// (back from Safari after Connect); whoop-source.js decides whether that asks the server. Connect
// opens the server's link in Safari, which keeps the whole sign-in in one browser (the server
// binds it to that browser). Failures are shown on the card and said to VoiceOver, and the line
// stays until the next fresh answer from the server. Never logs.
export function useWhoop() {
  const [shown, setShown] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const busyNow = useRef(false)
  const showing = useRef(null)
  const show = next => {
    showing.current = next
    setShown(next)
  }

  const [reload] = useState(() => coalesced(async () => {
    try {
      const s = await getWhoopSource()
      const before = showing.current
      const next = await s.read({ onCached: show })
      // A new answer from the server, not the same read again: an earlier failure line is past.
      if (next !== before && isGoodRead(next)) setMessage(null)
      show(next)
    } catch {
      // The app database would not open: nothing can be read or asked.
      show(showing.current ?? { paired: true, payload: null, cached: false })
    }
  }))

  useFocusReload(reload)
  useFocusEffect(useCallback(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') reload()
    })
    return () => sub.remove()
  }, [reload]))

  const say = text => {
    setMessage(text)
    announce(text)
  }

  // One action at a time; the buttons are disabled while one runs.
  const act = async fn => {
    if (busyNow.current) return
    busyNow.current = true
    setBusy(true)
    setMessage(null)
    try {
      await fn()
    } finally {
      busyNow.current = false
      setBusy(false)
    }
  }

  const connect = useCallback(() => act(async () => {
    let r
    try {
      r = await (await getWhoopSource()).connectLink()
      if (r.ok) {
        await Linking.openURL(r.url)
        return
      }
    } catch {
      r = { ok: false }
    }
    if (r.unconfigured) {
      // The card turns into the "isn't set up" line on the read that follows.
      await reload()
      announce(WHOOP_TEXT.unconfigured)
      return
    }
    say(r.elsewhere ? WHOOP_TEXT.pairedElsewhere(r.elsewhere) : WHOOP_TEXT.connectFailed)
  }), [reload])

  const disconnect = useCallback(() => {
    if (busyNow.current) return
    Alert.alert(WHOOP_TEXT.confirmTitle, WHOOP_TEXT.confirmBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => act(async () => {
          let r
          try {
            r = await (await getWhoopSource()).disconnect()
          } catch {
            r = { ok: false }
          }
          if (!r.ok) {
            say(WHOOP_TEXT.disconnectFailed)
            return
          }
          // The read first: its fresh answer would clear a line said before it.
          await reload()
          if (r.wasConnected && !r.revoked) say(WHOOP_TEXT.notRevoked)
          else announce(WHOOP_TEXT.disconnectDone)
        }),
      },
    ])
  }, [reload])

  return { shown, busy, message, connect, disconnect }
}
