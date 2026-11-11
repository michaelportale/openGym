import { Alert } from 'react-native'
import { SAVE_FAILED } from '../ui/messages.js'
import { customDelete } from './custom-ex-edit.js'

// After a delete lands, leave the exercise screens for the Exercises tab. dismissAll clears a
// form sitting on the exercise it deleted. With nothing to dismiss, replace opens the tab.
export function leaveForExercises(router) {
  if (router.canDismiss()) {
    router.dismissAll()
    router.navigate('/(tabs)/exercises')
    return
  }
  router.replace('/(tabs)/exercises')
}

// The stamp a fresh delete is based on: the copy's own entry, or null when the copy has none.
function copyStamp(copy, id) {
  const list = copy?.state?.customEx
  if (!Array.isArray(list)) return null
  const entry = list.find(e => e && e.id === id)
  return entry?._ts ?? null
}

// The form and the exercise screen ask the same way. A refusal is shown and nothing is saved.
// Confirm writes a fresh delete on the copy entry's stamp, then `onDone` once that write lands.
export function askDeleteCustom({ state, id, openEntries, copy, saveCustom, onError, onDone }) {
  const result = customDelete(state, id, openEntries)
  if (result.error) {
    onError(result.error)
    return
  }
  Alert.alert('Delete', undefined, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        const saved = await saveCustom({
          kind: 'customEx',
          key: id,
          baseTs: copyStamp(copy, id),
          value: result.value,
          fresh: true,
        })
        if (saved && saved.ok) onDone()
        else onError(SAVE_FAILED)
      },
    },
  ])
}
