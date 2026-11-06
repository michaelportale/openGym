import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { sharedLogicProof } from './src/shared/proof'

export default function App() {
  const { e1rm, catalogueSize } = sharedLogicProof()
  return (
    <View style={styles.container}>
      <Text>e1RM {e1rm}</Text>
      <Text>{catalogueSize} exercises</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center'
  }
})
