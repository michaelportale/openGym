import { destinationCopy } from '../../shell/destinations'
import UnbuiltScreen from '../../ui/UnbuiltScreen'

const copy = destinationCopy('progress')

export default function Progress() {
  return <UnbuiltScreen title={copy.title} phaseLabel={copy.phaseLabel} summary={copy.summary} status={copy.status} />
}
