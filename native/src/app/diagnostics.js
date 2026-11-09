import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import ServerSection from '../sync/ServerSection'
import HealthSection from '../health/HealthSection'
import { readVerdict } from '../health/gates'
import { toSessionDbHandle } from '../storage/db-handle'
import { runStorageCheck } from '../storage/probe'
import { removeGateWorkouts, runWorkoutGates } from '../health/run-gates'
import {
  deleteWorkout,
  findOwnWorkouts,
  findWorkoutsBySyncId,
  ownBundleId,
  readBodyMass,
  requestHealthAccess,
  saveStrengthWorkout
} from '../health/healthkit'

// A separate file from opengym.db, so the check can clear its rows and delete the file safely.
const PROBE_DATABASE_NAME = 'opengym-probe.db'
const MANUAL_ID = 'opengym-phase0-gate-manual'
const adapter = { saveStrengthWorkout, findWorkoutsBySyncId, findOwnWorkouts, deleteWorkout }
const message = e => (e && e.message) || String(e)

function ActionButton({ title, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <AppText variant="button" color={color.onAccent}>{title}</AppText>
    </Pressable>
  )
}

export default function Diagnostics() {
  const [proof] = useState(() => {
    const start = performance.now()
    const { sharedLogicProof } = require('../shared/proof')
    return { ...sharedLogicProof(), loadMs: Math.round(performance.now() - start) }
  })
  const { e1rm, catalogueSize, loadMs } = proof
  const [lines, setLines] = useState([])
  const [busy, setBusy] = useState(false)

  const run = async fn => {
    setBusy(true)
    try {
      setLines(await fn())
    } catch (e) {
      setLines(['error: ' + message(e)])
    } finally {
      setBusy(false)
    }
  }

  const gates = () =>
    run(async () => {
      const r = await runWorkoutGates(adapter, { nowMs: Date.now() })
      const out = r.gates.map(g => g.name + ': ' + g.status + (g.detail ? ' (' + g.detail + ')' : ''))
      if (r.leftovers === null) out.push('WARNING: could not read Health, test workouts may remain: check the Health app')
      else if (r.leftovers > 0) out.push('leftovers: ' + r.leftovers)
      return out
    })

  const readWeight = () =>
    run(async () => {
      const end = new Date()
      const start = new Date(end.getTime() - 30 * 24 * 3600000)
      const samples = await readBodyMass({ start, end })
      return ['read: ' + readVerdict(samples, await ownBundleId()), 'samples: ' + samples.length]
    })

  const saveManual = () =>
    run(async () => {
      const end = new Date()
      await saveStrengthWorkout({ id: MANUAL_ID, version: 1, start: new Date(end.getTime() - 3600000), end, volumeLb: 1000 })
      const found = await findWorkoutsBySyncId(MANUAL_ID)
      return ['test workouts: ' + found.length]
    })

  const removeTests = () =>
    run(async () => {
      const r = await removeGateWorkouts(adapter, await ownBundleId())
      const out = ['removed: ' + r.removed, 'left: ' + r.left, 'other workouts from this app (kept): ' + r.other]
      if (r.error) out.push('error: ' + r.error)
      return out
    })

  // A stale scratch file from a killed check is deleted before it is opened (runStorageCheck).
  const storageCheck = () =>
    run(() => runStorageCheck({
      open: async () => {
        const expoDb = await openDatabaseAsync(PROBE_DATABASE_NAME)
        return { handle: toSessionDbHandle(expoDb), close: () => expoDb.closeAsync() }
      },
      remove: () => deleteDatabaseAsync(PROBE_DATABASE_NAME),
    }))

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} alwaysBounceVertical={false}>
      <ServerSection />
      <HealthSection />
      <AppText variant="value">e1RM {e1rm}</AppText>
      <AppText variant="body" color={color.textSecondary}>{catalogueSize} exercises</AppText>
      <AppText variant="body" color={color.textSecondary}>training.js load: {loadMs} ms</AppText>
      <View style={styles.buttons}>
        <ActionButton title="Request access" disabled={busy} onPress={() => run(async () => { await requestHealthAccess(); return ['access requested'] })} />
        <ActionButton title="Run workout gates" disabled={busy} onPress={gates} />
        <ActionButton title="Read body weight" disabled={busy} onPress={readWeight} />
        <ActionButton title="Save one test workout" disabled={busy} onPress={saveManual} />
        <ActionButton title="Remove test workouts" disabled={busy} onPress={removeTests} />
        <ActionButton title="Storage check" disabled={busy} onPress={storageCheck} />
      </View>
      <View style={styles.output}>
        {lines.map((l, i) => (
          <AppText key={i} variant="body">{l}</AppText>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bg },
  content: { alignItems: 'center', paddingTop: space.xl, paddingBottom: space.xl, gap: space.xs },
  buttons: { marginTop: space.lg, alignSelf: 'stretch', paddingHorizontal: space.lg, gap: space.sm },
  button: {
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: color.accent
  },
  buttonDisabled: { opacity: 0.4 },
  output: { alignSelf: 'stretch', padding: space.lg }
})
