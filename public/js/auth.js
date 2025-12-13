// Check authentication status
async function checkAuth() {
    try {
        const response = await fetch('/auth/user', {
            credentials: 'include'
        });

        if (!response.ok) {
            // Not authenticated, redirect to login
            window.location.href = '/login.html';
            return null;
        }

        const user = await response.json();
        return user;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login.html';
        return null;
    }
}

// Display user info
function displayUserInfo(user) {
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');

    if (userAvatar && user.picture) {
        userAvatar.src = user.picture;
    }

    if (userName) {
        userName.textContent = user.name || user.email;
    }
}

// Logout handler
function setupLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            window.location.href = '/auth/logout';
        });
    }
}

// Initialize auth on page load
if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    checkAuth().then(user => {
        if (user) {
            displayUserInfo(user);
            setupLogout();

            // Start dashboard functionality
            if (window.startDashboard) {
                window.startDashboard();
            }
        }
    });
}
