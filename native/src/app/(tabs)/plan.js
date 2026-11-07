import { destinationCopy } from '../../shell/destinations'
import UnbuiltScreen from '../../ui/UnbuiltScreen'

const copy = destinationCopy('plan')

export default function Plan() {
  return <UnbuiltScreen title={copy.title} phaseLabel={copy.phaseLabel} summary={copy.summary} status={copy.status} />
}
