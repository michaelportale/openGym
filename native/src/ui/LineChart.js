import { useState } from 'react'
import { View } from 'react-native'
import Svg, { Circle, Line, Polyline } from 'react-native-svg'
import { color, space } from '../theme/tokens'
import AppText from './AppText'
import { chartModel } from './chart-model'

const num = (n) => String(Math.round(n * 10) / 10)

// points / trend: [{ t: ms, y: lb, d?: 'YYYY-MM-DD' }]. dotsOnly: no line, only the dots. The
// chart is one image to a screen reader, named by `label`.
export default function LineChart({ points, trend = null, goal = null, dotsOnly = false, height = 160, label }) {
  const [width, setWidth] = useState(0)
  const model = width > 0 ? chartModel({ points, trend, goal, dotsOnly, width, height }) : null

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {model ? (
        <>
          <View style={{ height }}>
            <Svg width={width} height={height}>
              {model.goalY !== null && (
                <Line x1={8} x2={width - 8} y1={model.goalY} y2={model.goalY} stroke={color.stroke} strokeWidth={1} strokeDasharray="4 4" />
              )}
              {model.line && <Polyline points={model.line} fill="none" stroke={color.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {model.dots.map((d, i) => (
                <Circle key={i} cx={d.x} cy={d.y} r={2.5} fill={color.textMuted} fillOpacity={0.5} />
              ))}
            </Svg>
            <AppText variant="label" color={color.textMuted} style={{ position: 'absolute', top: 0, left: 0 }}>{num(model.yMax)}</AppText>
            <AppText variant="label" color={color.textMuted} style={{ position: 'absolute', bottom: 0, left: 0 }}>{num(model.yMin)}</AppText>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs }}>
            <AppText variant="label" color={color.textMuted}>{model.xFirst}</AppText>
            <AppText variant="label" color={color.textMuted}>{model.xLast}</AppText>
          </View>
        </>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  )
}
