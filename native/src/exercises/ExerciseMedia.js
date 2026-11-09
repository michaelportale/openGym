import { useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import { useEventListener } from 'expo'
import { useVideoPlayer, VideoView } from 'expo-video'
import { color, radius, space } from '../theme/tokens'
import { MEDIA_CREDIT } from './detail-view'
import AppText from '../ui/AppText'
import { useAccessibilityFlag } from '../ui/use-accessibility-flag'

// The still from the user's server, with the clip over it once the player is ready, and the media
// credit under it. The block takes no space until the still has loaded, and renders nothing if it
// can't (the clip alone, with no still, is not shown). A player error keeps the still. Tap plays or pauses.
export default function ExerciseMedia({ media, style = null }) {
  const reduceMotion = useAccessibilityFlag('reduceMotion')
  const [stillFailed, setStillFailed] = useState(false)
  const [stillLoaded, setStillLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  const player = useVideoPlayer({ uri: media.clip, useCaching: true }, p => {
    p.muted = true
    p.loop = true
    p.audioMixingMode = 'mixWithOthers'
    p.keepScreenOnWhilePlaying = false
    if (!reduceMotion) p.play()
  })
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay') setReady(true)
    else if (status === 'error') { setFailed(true); setReady(false) }
  })
  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying))

  // A player that was ready (or failed) before the listeners attached sent its event to nobody.
  useEffect(() => {
    if (player.status === 'readyToPlay') setReady(true)
    else if (player.status === 'error') setFailed(true)
    setPlaying(player.playing)
  }, [player])

  if (stillFailed) return null
  const toggle = () => { if (playing) player.pause(); else player.play() }
  return (
    <View
      style={stillLoaded ? style : styles.hidden}
      accessibilityElementsHidden={!stillLoaded}
      importantForAccessibility={stillLoaded ? 'auto' : 'no-hide-descendants'}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Exercise animation, ${playing ? 'playing' : 'paused'}`}
        onPress={toggle}
        style={styles.box}
      >
        <Image
          source={{ uri: media.still }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onLoad={() => setStillLoaded(true)}
          onError={() => setStillFailed(true)}
        />
        {ready && !failed ? (
          <View style={StyleSheet.absoluteFill}>
            <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
          </View>
        ) : null}
      </Pressable>
      <AppText variant="label" color={color.textMuted} style={styles.credit}>{MEDIA_CREDIT}</AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  // Out of the flow (and the parent's gap) with no height until the still has loaded.
  hidden: { position: 'absolute', left: 0, width: '100%', height: 0, overflow: 'hidden' },
  credit: { marginTop: space.xs },
  box: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: color.surface
  }
})
