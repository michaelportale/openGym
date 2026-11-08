import { destinationCopy } from '../../shell/destinations'
import UnbuiltScreen from '../../ui/UnbuiltScreen'

const copy = destinationCopy('exercises')

export default function Exercises() {
  return <UnbuiltScreen title={copy.title} phaseLabel={copy.phaseLabel} summary={copy.summary} status={copy.status} />
}
