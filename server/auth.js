const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const { createOrUpdateUser, getUserById } = require('./database');

function setupAuth() {
    // Serialize user for session
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    // Deserialize user from session
    passport.deserializeUser((id, done) => {
        const user = getUserById(id);
        done(null, user);
    });

    // Google OAuth Strategy
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5008/auth/google/callback'
    }, (accessToken, refreshToken, profile, done) => {
        // Create or update user in database
        const userData = {
            id: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            picture: profile.photos[0]?.value
        };

        const user = createOrUpdateUser(userData);
        console.log('✅ User authenticated and saved to database:', user.email);

        return done(null, user);
    }));
}

// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Not authenticated' });
}

// Generate JWT token
function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email },
        process.env.SESSION_SECRET,
        { expiresIn: '7d' }
    );
}

module.exports = {
    setupAuth,
    ensureAuthenticated,
    generateToken
};
