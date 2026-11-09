import { useState } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'
import { useEventListener } from 'expo'
import { useVideoPlayer, VideoView } from 'expo-video'
import { color, radius } from '../theme/tokens'
import { useAccessibilityFlag } from '../ui/use-accessibility-flag'

// The still from the user's server, with the clip over it once the player is ready. A still that
// fails to load hides the block; a player error keeps the still. Tap plays or pauses.
export default function ExerciseMedia({ media }) {
  const reduceMotion = useAccessibilityFlag('reduceMotion')
  const [stillFailed, setStillFailed] = useState(false)
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

  if (stillFailed) return null
  const toggle = () => { if (playing) player.pause(); else player.play() }
  return (
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
        onError={() => setStillFailed(true)}
      />
      {ready && !failed ? (
        <View style={StyleSheet.absoluteFill}>
          <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  box: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: color.surface
  }
})
