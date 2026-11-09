import { destinationCopy } from '../../shell/destinations'
import UnbuiltScreen from '../../ui/UnbuiltScreen'

const copy = destinationCopy('home')

export default function Home() {
  return <UnbuiltScreen title={copy.title} phaseLabel={copy.phaseLabel} summary={copy.summary} status={copy.status} />
}
