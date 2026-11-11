const fs = require('fs')
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// The shared training logic lives in the web app and is imported in place. The English exercise
// text (steps and descriptions) sits in two sibling folders and is imported in place too, lazily.
config.watchFolders = [
  path.resolve(__dirname, '../frontend/src/lib'),
  path.resolve(__dirname, '../frontend/src/instr'),
  path.resolve(__dirname, '../frontend/src/exercise-desc'),
]

// Xcode archives run their build phases with ACTION=install. Release Run builds stay personal.
// shortcut: prebuilt/eager bundles bypass Metro; add artifact validation before supporting their distribution.
const distributionFlag = process.env.OPENGYM_DISTRIBUTION
if (distributionFlag && !['0', '1'].includes(distributionFlag)) {
  throw new Error('OPENGYM_DISTRIBUTION must be 1 (distribution) or 0 (personal); omit it for automatic Xcode archive detection.')
}
const distribution = ['install', 'archive'].includes(process.env.ACTION) || distributionFlag === '1'
config.cacheVersion = `${config.cacheVersion ?? ''}:opengym-${distribution ? 'distribution' : 'personal'}`

// Distribution bundles always use the example. Personal snapshots are checked at resolve time,
// so generating the file later needs no config change. Never move or read the owner's file here.
const local = path.resolve(__dirname, 'local/snapshot.json')
const example = path.resolve(__dirname, 'src/data/snapshot.example.json')
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@opengym/snapshot') {
    return { type: 'sourceFile', filePath: !distribution && fs.existsSync(local) ? local : example }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
