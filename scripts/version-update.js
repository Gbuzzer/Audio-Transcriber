/**
 * version-update.js
 * This script automatically updates the version.json file on build
 * It increments the build number and updates the timestamp
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Path to version file
const versionFilePath = path.join(__dirname, '..', 'version.json');

// Update version information
function updateVersion() {
  try {
    // Read current version file
    const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
    
    // Increment build number
    versionData.build += 1;
    
    // Update date
    versionData.date = new Date().toISOString();
    
    // Write updated version back to file
    fs.writeFileSync(versionFilePath, JSON.stringify(versionData, null, 2));
    
    // Log the new version
    console.log(`Version updated to ${versionData.major}.${versionData.minor}.${versionData.patch} (Build ${versionData.build})`);
    
    // Also update package.json version to match
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageJson.version = `${versionData.major}.${versionData.minor}.${versionData.patch}`;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    return versionData;
  } catch (error) {
    console.error('Error updating version:', error);
    process.exit(1);
  }
}

// Push changes to GitHub
function pushToGitHub(versionData) {
  try {
    // Get the current branch
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    
    // Stage all changes
    execSync('git add .');
    
    // Commit with version info
    const commitMessage = `Build ${versionData.build}: Version ${versionData.major}.${versionData.minor}.${versionData.patch}`;
    execSync(`git commit -m "${commitMessage}"`);
    
    // Push to GitHub
    execSync(`git push origin ${branch}`);
    
    console.log(`Successfully pushed version ${versionData.major}.${versionData.minor}.${versionData.patch} (Build ${versionData.build}) to GitHub`);
  } catch (error) {
    console.error('Error pushing to GitHub:', error);
    process.exit(1);
  }
}

// Main function
function main() {
  const versionData = updateVersion();
  pushToGitHub(versionData);
}

// Execute if run directly
if (require.main === module) {
  main();
}

module.exports = { updateVersion, pushToGitHub };
