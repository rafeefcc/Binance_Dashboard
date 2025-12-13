const { getUserSettings, saveUserSettings } = require('./database');

// Get public settings for a user
function getPublicSettings(userId) {
    return getUserSettings(userId);
}

// Save settings for a user
function saveSettings(userId, newSettings) {
    saveUserSettings(userId, newSettings);
    return getPublicSettings(userId);
}

module.exports = {
    getPublicSettings,
    saveSettings
};
