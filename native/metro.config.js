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

function readFlag(name) {
  const value = process.env[name]
  if (value !== undefined && value !== '0' && value !== '1') {
    throw new Error(`${name} must be 0 or 1 when set.`)
  }
  return value === '1'
}

// Xcode archives usually run with ACTION=install and must ignore a personal opt-in.
// shortcut: prebuilt/eager bundles bypass Metro; add artifact validation before supporting their distribution.
const distribution = readFlag('OPENGYM_DISTRIBUTION')
const personal = readFlag('OPENGYM_PERSONAL_SNAPSHOT')
const usePersonalSnapshot = personal && !distribution && !['install', 'archive'].includes(process.env.ACTION)
config.cacheVersion = `${config.cacheVersion ?? ''}:opengym-${usePersonalSnapshot ? 'personal' : 'example'}`

// Check an opted-in snapshot at resolve time so it can be generated after Metro starts.
const local = path.resolve(__dirname, 'local/snapshot.json')
const example = path.resolve(__dirname, 'src/data/snapshot.example.json')
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@opengym/snapshot') {
    return { type: 'sourceFile', filePath: usePersonalSnapshot && fs.existsSync(local) ? local : example }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
