import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import { cap } from '../sync/source'
import { libraryView } from './library-view'

const rowLabel = r => `${r.name}, ${r.sub}${r.yours ? ', yours' : ''}${r.fav ? ', favourite' : ''}`

const Row = memo(function Row({ row, onPick }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rowLabel(row)}
      onPress={() => onPick(row.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <AppText variant="heading">{row.name}</AppText>
        <AppText variant="label" color={color.textMuted}>{row.sub}</AppText>
      </View>
      {row.yours ? <AppText variant="label" color={color.accent} style={styles.tag}>Yours</AppText> : null}
      {row.fav ? <AppText variant="heading" color={color.accent} accessible={false}>★</AppText> : null}
    </Pressable>
  )
})

const Chip = memo(function Chip({ label, selected, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <AppText variant="label" color={selected ? color.onAccent : color.textSecondary}>{label}</AppText>
    </Pressable>
  )
})

function ChipRow({ options, value, onChange, anyLabel }) {
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map(o => (
        <Chip
          key={o || 'any'}
          label={o ? cap(o) : anyLabel}
          selected={value === o}
          onPress={() => onChange(o)}
        />
      ))}
    </ScrollView>
  )
}

// The searchable, filterable exercise list. `header` (the screen header) renders inside the list so
// it is the screen's first scroll view, which the native tabs inset. `onPick(id)` only; no navigation,
// so the Phase 7C picker can reuse it.
export default function ExerciseList({ state, onPick, header = null }) {
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [cat, setCat] = useState('')
  const [eq, setEq] = useState('')
  const [showAll, setShowAll] = useState(false)
  const dq = useDeferredValue(q)

  const view = useMemo(
    () => libraryView({ state, q: dq, bp, cat, eq, showAll }),
    [state, dq, bp, cat, eq, showAll]
  )

  const renderItem = useCallback(({ item }) => <Row row={item} onPick={onPick} />, [onPick])

  const empty = dq.trim() ? (
    <View style={styles.empty}>
      <AppText variant="body" color={color.textSecondary} style={styles.inset}>{`No exercise matches “${dq.trim()}”.`}</AppText>
      {view.similar.length ? (
        <View style={styles.similar}>
          <AppText variant="label" color={color.textMuted} accessibilityRole="header" style={styles.inset}>Close matches</AppText>
          {view.similar.map(r => <Row key={r.id} row={r} onPick={onPick} />)}
        </View>
      ) : null}
    </View>
  ) : null

  // The search field is uncontrolled (no `value`): a controlled field inside the list header races
  // fast typing against the deferred recompute and scrambles the text. The header is memoised so a
  // keystroke does not re-render it.
  const controls = useMemo(() => (
    <View>
      {header}
      <View style={styles.searchWrap}>
        <TextInput
          accessibilityLabel="Search exercises"
          style={styles.input}
          onChangeText={setQ}
          placeholder="Search exercises"
          placeholderTextColor={color.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>
      <ChipRow options={view.bodyParts} value={bp} onChange={b => { setBp(b); if (!b) setEq('') }} anyLabel="All" />
      {view.catOpts.length > 1 ? (
        <ChipRow options={['', ...view.catOpts]} value={view.catOn} onChange={setCat} anyLabel="Any type" />
      ) : null}
      {view.eqOpts.length > 1 ? (
        <ChipRow options={['', ...view.eqOpts]} value={view.eqOn} onChange={setEq} anyLabel="Any equipment" />
      ) : null}
      {view.profileActive ? (
        <View style={styles.switchRow}>
          <AppText variant="body" color={color.textSecondary} style={styles.switchLabel}>Show all equipment</AppText>
          <Switch
            accessibilityLabel="Show all equipment"
            value={showAll}
            onValueChange={setShowAll}
            trackColor={{ false: color.track, true: color.accent }}
          />
        </View>
      ) : null}
    </View>
  ), [header, view.bodyParts, view.catOpts, view.catOn, view.eqOpts, view.eqOn, view.profileActive, bp, showAll])

  return (
    <FlatList
      style={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={view.rows}
      keyExtractor={item => item.id}
      renderItem={renderItem}
      ListHeaderComponent={controls}
      ListEmptyComponent={empty}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.content}
    />
  )
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl },
  searchWrap: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  input: {
    minHeight: touch.row,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.stroke,
    backgroundColor: color.field,
    color: color.text,
    fontSize: 17
  },
  chips: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm },
  chip: {
    minHeight: touch.min,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.stroke,
    backgroundColor: color.control
  },
  chipOn: { backgroundColor: color.accent, borderColor: color.accent },
  switchRow: {
    minHeight: touch.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    gap: space.md
  },
  switchLabel: { flex: 1 },
  row: {
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.stroke
  },
  pressed: { backgroundColor: color.surfaceActive },
  rowText: { flex: 1, gap: 2 },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: color.accent },
  inset: { paddingHorizontal: space.lg },
  empty: { paddingTop: space.lg, gap: space.lg },
  similar: { gap: space.xs }
})
