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

// `@opengym/snapshot` is the owner's gitignored snapshot when it exists, else the committed example.
// Checked at resolve time, so generating the file later needs no config change.
const local = path.resolve(__dirname, 'local/snapshot.json')
const example = path.resolve(__dirname, 'src/data/snapshot.example.json')
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@opengym/snapshot') {
    return { type: 'sourceFile', filePath: fs.existsSync(local) ? local : example }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
