import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import ExerciseMedia from '../exercises/ExerciseMedia'
import IconButton from '../ui/IconButton'
import PrimaryButton from '../ui/PrimaryButton'
import SecondaryButton from '../ui/SecondaryButton'
import { SAVE_FAILED } from '../ui/messages'
import { announce } from '../plan/announce'
import { cap } from '../sync/source'
import { stampOf } from '../sync/edit-guard'
import { equipment, exercises, muscles } from '../shared/training'
import { customFormEdit, muscleSeed } from '../exercises/custom-ex-edit'
import { askDeleteCustom, leaveForExercises } from '../exercises/delete-custom'
import { canAuthorCustom } from '../exercises/exercise-notices'
import { routeId } from '../exercises/route-id'
import { useExerciseSource } from '../exercises/use-exercise-source'

const textOf = value => (typeof value === 'string' ? value : '')
const muscleLabel = m => muscles.MUSCLE_NAME[m] || m

// ExerciseMedia plays a catalogue still and clip. A custom photo is a MediaRef (a hash, no
// address). The phone has no media store, so that file is kept on save and not played here.
function playerMedia(exercise) {
  const media = exercise?.media
  if (!media || typeof media !== 'object' || Array.isArray(media)) return null
  if (typeof media.still !== 'string' || media.still === '') return null
  if (typeof media.clip !== 'string' || media.clip === '') return null
  return media
}

function Chip({ label, selected, onPress, accessibilityLabel }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <AppText variant="label" color={selected ? color.onAccent : color.textSecondary}>{label}</AppText>
    </Pressable>
  )
}

function Form({ id, editing, stored, source, router }) {
  const [n, setN] = useState(() => textOf(stored?.n))
  const [bp, setBp] = useState(() => textOf(stored?.bp))
  const [eq, setEq] = useState(() => textOf(stored?.eq))
  const [primaries, setPrimaries] = useState(() => muscleSeed(stored).primaries)
  const [secondaries, setSecondaries] = useState(() => muscleSeed(stored).secondaries)
  const [desc, setDesc] = useState(() => textOf(stored?.desc))
  const [url, setUrl] = useState(() => textOf(stored?.url))
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const opened = useRef(null)
  if (opened.current == null) {
    opened.current = {
      stored,
      baseTs: editing ? stampOf(source.copy?.state, 'customEx', id) : 0,
    }
  }
  const latest = useRef(null)
  latest.current = {
    state: source.state,
    copy: source.copy,
    openEntries: source.openEntries,
    saveCustom: source.saveCustom,
  }

  const show = text => {
    setMessage(text)
    announce(text)
  }
  const equipmentNames = equipment.ALL_EQUIPMENT.slice()
  if (typeof stored?.eq === 'string' && stored.eq && !equipmentNames.includes(stored.eq)) equipmentNames.push(stored.eq)
  const media = playerMedia(stored)
  const additional = muscles.MUSCLES.filter(m => !primaries.includes(m))

  const toggle = (list, setList, muscle) => {
    setList(list.includes(muscle) ? list.filter(m => m !== muscle) : [...list, muscle])
  }
  const togglePrimary = muscle => {
    const on = primaries.includes(muscle)
    setPrimaries(on ? primaries.filter(m => m !== muscle) : [...primaries, muscle])
    if (!on) setSecondaries(current => current.filter(m => m !== muscle))
  }

  const onSave = async () => {
    if (lock.current) return
    const now = latest.current
    const form = opened.current
    const edit = customFormEdit({
      editing,
      id,
      baseTs: form.baseTs,
      stored: form.stored,
      state: now.state,
      input: { n, bp, eq, primaries, secondaries, desc, url },
    })
    if (typeof edit.value?.id !== 'string') {
      show(edit.error)
      return
    }
    lock.current = true
    setBusy(true)
    setMessage(null)
    const saved = await now.saveCustom(edit)
    lock.current = false
    setBusy(false)
    if (!saved.ok) {
      show(SAVE_FAILED)
      return
    }
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)/exercises')
  }

  const onDelete = () => {
    if (lock.current) return
    const now = latest.current
    askDeleteCustom({
      state: now.state,
      id,
      openEntries: now.openEntries,
      copy: now.copy,
      saveCustom: now.saveCustom,
      onError: show,
      onDone: () => leaveForExercises(router),
    })
  }

  return (
    <>
      <AppText variant="title" accessibilityRole="header" style={styles.pad}>
        {editing ? 'Edit exercise' : 'New exercise'}
      </AppText>
      <View style={styles.field}>
        <AppText variant="label" color={color.textMuted}>Name</AppText>
        <TextInput
          accessibilityLabel="Name"
          style={styles.input}
          value={n}
          onChangeText={setN}
          placeholder="Name"
          placeholderTextColor={color.textMuted}
          autoCorrect={false}
          maxLength={80}
        />
      </View>
      <View style={styles.field}>
        <AppText variant="label" color={color.textMuted}>Body part</AppText>
        <View style={styles.chips}>
          {exercises.BODYPARTS.map(part => (
            <Chip
              key={part}
              label={cap(part)}
              selected={bp === part}
              accessibilityLabel={`Body part ${part}`}
              onPress={() => setBp(part)}
            />
          ))}
        </View>
      </View>
      <View style={styles.field}>
        <AppText variant="label" color={color.textMuted}>Equipment</AppText>
        <View style={styles.chips}>
          {equipmentNames.map(name => (
            <Chip
              key={name}
              label={cap(name)}
              selected={eq === name}
              accessibilityLabel={`Equipment ${name}`}
              onPress={() => setEq(name)}
            />
          ))}
        </View>
      </View>
      {bp === 'cardio' ? null : (
        <View style={styles.field}>
          <AppText variant="label" color={color.textMuted}>Primary muscles</AppText>
          <View style={styles.chips}>
            {muscles.MUSCLES.map(m => (
              <Chip
                key={m}
                label={muscleLabel(m)}
                selected={primaries.includes(m)}
                accessibilityLabel={`Primary ${muscleLabel(m)}`}
                onPress={() => togglePrimary(m)}
              />
            ))}
          </View>
        </View>
      )}
      <View style={styles.field}>
        <AppText variant="label" color={color.textMuted}>Additional muscles</AppText>
        <View style={styles.chips}>
          {additional.map(m => (
            <Chip
              key={m}
              label={muscleLabel(m)}
              selected={secondaries.includes(m)}
              accessibilityLabel={`Additional ${muscleLabel(m)}`}
              onPress={() => toggle(secondaries, setSecondaries, m)}
            />
          ))}
        </View>
      </View>
      {bp === 'cardio' ? (
        <AppText variant="body" color={color.textSecondary} style={styles.pad}>
          Cardio exercises log time and speed instead of weight and reps.
        </AppText>
      ) : null}
      <View style={styles.field}>
        <AppText variant="label" color={color.textMuted}>Description</AppText>
        <TextInput
          accessibilityLabel="Description"
          style={[styles.input, styles.multiline]}
          value={desc}
          onChangeText={setDesc}
          placeholder="Description"
          placeholderTextColor={color.textMuted}
          multiline
          maxLength={1000}
        />
      </View>
      <View style={styles.field}>
        <AppText variant="label" color={color.textMuted}>Link</AppText>
        <TextInput
          accessibilityLabel="Link"
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="Link"
          placeholderTextColor={color.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardType="url"
        />
      </View>
      {media ? <ExerciseMedia key={media.clip} media={media} style={styles.pad} /> : null}
      {message ? (
        <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.pad}>{message}</AppText>
      ) : null}
      <View style={styles.actions}>
        <PrimaryButton label="Save" accessibilityLabel="Save exercise" disabled={busy} onPress={onSave} />
        {editing ? (
          <SecondaryButton label="Delete" accessibilityLabel="Delete exercise" disabled={busy} onPress={onDelete} />
        ) : null}
      </View>
    </>
  )
}

export default function CustomExercise() {
  const params = useLocalSearchParams()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const id = routeId(params.id)
  const editing = id !== ''
  const source = useExerciseSource()

  useEffect(() => {
    if (source.status === 'ready' && !canAuthorCustom(source.copy)) router.replace('/(tabs)/exercises')
  }, [source.status, source.copy, router])

  const stored = editing && source.status === 'ready'
    ? (source.state?.customEx || []).find(e => e && e.id === id) || null
    : null
  const back = (
    <View style={styles.back}>
      <IconButton label="Back" accessibilityLabel="Back" onPress={() => router.back()} />
    </View>
  )
  let body = null
  if (source.status === 'error') {
    body = (
      <AppText variant="body" color={color.textSecondary} style={styles.pad}>
        {source.error?.message || 'Could not load this exercise.'}
      </AppText>
    )
  } else if (source.status !== 'ready') {
    body = (
      <AppText variant="body" color={color.textSecondary} style={styles.pad}>Loading…</AppText>
    )
  } else if (!canAuthorCustom(source.copy)) {
    body = null
  } else if (editing && !stored) {
    body = (
      <AppText variant="body" color={color.textSecondary} style={styles.pad}>
        This exercise isn't in your library any more.
      </AppText>
    )
  } else {
    body = <Form key={editing ? id : 'new'} id={id} editing={editing} stored={stored} source={source} router={router} />
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      {back}
      {body}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl * 2, gap: space.md },
  back: { paddingHorizontal: space.lg, alignItems: 'flex-start' },
  pad: { marginHorizontal: space.lg },
  field: { marginHorizontal: space.lg, gap: space.sm },
  input: {
    minHeight: touch.row,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.stroke,
    backgroundColor: color.field,
    color: color.text,
    fontSize: 17,
  },
  multiline: { minHeight: 96, paddingTop: space.md, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: touch.min,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.stroke,
    backgroundColor: color.control,
  },
  chipOn: { backgroundColor: color.accent, borderColor: color.accent },
  actions: { marginHorizontal: space.lg, gap: space.sm },
})
