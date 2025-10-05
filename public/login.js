let currentPin = '';
const maxPinLength = 4;

// Check if user is already authenticated by trying to access a protected endpoint
window.addEventListener('load', async () => {
    try {
        const response = await fetch('/api/version');
        if (response.ok) {
            // User is already authenticated, redirect to main app
            window.location.href = '/';
        }
    } catch (error) {
        // User is not authenticated, stay on login page
        console.log('User not authenticated, showing login page');
    }
});

function addDigit(digit) {
    if (currentPin.length < maxPinLength) {
        currentPin += digit;
        updatePinDisplay();
        
        // Auto-submit when 4 digits are entered
        if (currentPin.length === maxPinLength) {
            setTimeout(submitPin, 300);
        }
    }
}

function clearPin() {
    if (currentPin.length > 0) {
        currentPin = currentPin.slice(0, -1);
        updatePinDisplay();
        hideError();
    }
}

function updatePinDisplay() {
    for (let i = 1; i <= maxPinLength; i++) {
        const dot = document.getElementById(`dot${i}`);
        if (i <= currentPin.length) {
            dot.classList.add('filled');
        } else {
            dot.classList.remove('filled');
        }
    }
}

async function submitPin() {
    if (currentPin.length !== maxPinLength) {
        showError('Please enter a 4-digit PIN');
        return;
    }

    try {
        const response = await fetch('/api/authenticate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pin: currentPin }),
        });

        const result = await response.json();

        if (result.success) {
            // Success animation
            document.querySelector('.login-card').classList.add('success');
            
            // Redirect to main app
            setTimeout(() => {
                window.location.href = '/';
            }, 600);
        } else {
            // Wrong PIN animation and error
            document.querySelector('.login-card').classList.add('shake');
            showError('Incorrect PIN. Please try again.');
            
            // Clear PIN and reset
            setTimeout(() => {
                currentPin = '';
                updatePinDisplay();
                document.querySelector('.login-card').classList.remove('shake');
            }, 500);
        }
    } catch (error) {
        showError('Authentication failed. Please try again.');
        currentPin = '';
        updatePinDisplay();
    }
}

function showError(message) {
    const errorElement = document.getElementById('error-message');
    errorElement.textContent = message;
    errorElement.classList.add('show');
}

function hideError() {
    const errorElement = document.getElementById('error-message');
    errorElement.classList.remove('show');
}

// Keyboard support
document.addEventListener('keydown', (event) => {
    const key = event.key;
    
    if (key >= '0' && key <= '9') {
        addDigit(key);
    } else if (key === 'Backspace') {
        clearPin();
    } else if (key === 'Enter') {
        submitPin();
    }
});

// Prevent right-click and common shortcuts
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'u' || e.key === 'U' || e.key === 's' || e.key === 'S')) {
        e.preventDefault();
    }
    if (e.key === 'F12') {
        e.preventDefault();
    }
});
