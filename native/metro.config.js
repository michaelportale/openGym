const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// The shared training logic lives in the web app and is imported in place.
config.watchFolders = [path.resolve(__dirname, '../frontend/src/lib')]

module.exports = config
