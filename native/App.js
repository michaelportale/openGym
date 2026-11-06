import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import { sharedLogicProof } from './src/shared/proof'
import { readVerdict } from './src/health/gates'
import { runWorkoutGates } from './src/health/run-gates'
import {
  deleteWorkout,
  findWorkoutsBySyncId,
  readBodyMass,
  requestHealthAccess,
  saveStrengthWorkout
} from './src/health/healthkit'

const OWN_BUNDLE = 'io.github.michaelportale.opengym'
const MANUAL_ID = 'opengym-phase0-gate-manual'
const adapter = { saveStrengthWorkout, findWorkoutsBySyncId, deleteWorkout }
const message = e => (e && e.message) || String(e)

export default function App() {
  const { e1rm, catalogueSize } = sharedLogicProof()
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
      return ['read: ' + readVerdict(samples, OWN_BUNDLE), 'samples: ' + samples.length]
    })

  const saveManual = () =>
    run(async () => {
      const end = new Date()
      await saveStrengthWorkout({ id: MANUAL_ID, version: 1, start: new Date(end.getTime() - 3600000), end, volumeLb: 1000 })
      const found = await findWorkoutsBySyncId(MANUAL_ID)
      return ['test workouts: ' + found.length]
    })

  const removeManual = () =>
    run(async () => {
      let removed = 0
      for (const w of await findWorkoutsBySyncId(MANUAL_ID)) removed += await deleteWorkout(w.uuid)
      const left = await findWorkoutsBySyncId(MANUAL_ID)
      return ['removed: ' + removed, 'left: ' + left.length]
    })

  return (
    <View style={styles.container}>
      <Text>e1RM {e1rm}</Text>
      <Text>{catalogueSize} exercises</Text>
      <View style={styles.buttons}>
        <Button title="Request access" disabled={busy} onPress={() => run(async () => { await requestHealthAccess(); return ['access requested'] })} />
        <Button title="Run workout gates" disabled={busy} onPress={gates} />
        <Button title="Read body weight" disabled={busy} onPress={readWeight} />
        <Button title="Save one test workout" disabled={busy} onPress={saveManual} />
        <Button title="Remove test workouts" disabled={busy} onPress={removeManual} />
      </View>
      <ScrollView style={styles.output}>
        {lines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60
  },
  buttons: { marginTop: 16 },
  output: { flex: 1, alignSelf: 'stretch', padding: 16 }
})
