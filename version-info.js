/**
 * version-info.js
 * Exposes version information from version.json for use in the application
 */

const fs = require('fs');
const path = require('path');

// Read version information from file
const versionFilePath = path.join(__dirname, 'version.json');
const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));

// Format full version string
const versionString = `${versionData.major}.${versionData.minor}.${versionData.patch}`;
const buildString = `Build ${versionData.build}`;

module.exports = {
  major: versionData.major,
  minor: versionData.minor, 
  patch: versionData.patch,
  build: versionData.build,
  date: versionData.date,
  version: versionString,
  buildNumber: buildString,
  fullVersion: `v${versionString} (${buildString})`
};
