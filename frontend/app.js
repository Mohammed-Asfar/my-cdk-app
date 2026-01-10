// ==========================================
// Configuration - UPDATE THESE AFTER CDK DEPLOY
// ==========================================
const CONFIG = {
    userPoolId: 'ap-south-1_ySvEg3wQe',
    clientId: '21g29n3gn0tgjo6r4jjhn67hlh',
    apiEndpoint: 'https://4jcswff7ef.execute-api.ap-south-1.amazonaws.com/prod/',
    region: 'ap-south-1'
};

// ==========================================
// State
// ==========================================
let currentUser = null;
let idToken = null;
let userRoles = [];
let operand1 = null;
let operation = null;
let shouldResetDisplay = false;
let pendingPhone = '';
let pendingUsername = '';
let phoneSession = null;

// Role permissions - will be updated dynamically from API
let ROLE_PERMISSIONS = {
    'DMrole': ['divide', 'multiply'],
    'ASrole': ['add', 'subtract'],
    'AdminRole': ['add', 'subtract', 'divide', 'multiply'] // Admin can do everything
};

// ==========================================
// JWT Token Parsing
// ==========================================

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error('Failed to parse JWT:', e);
        return null;
    }
}

function extractRolesFromToken(token) {
    const payload = parseJwt(token);
    if (!payload) return [];
    const groups = payload['cognito:groups'] || [];
    return Array.isArray(groups) ? groups : [groups];
}

// ==========================================
// Tab Navigation Functions
// ==========================================

function showMainTab(tab) {
    const loginSection = document.getElementById('loginSection');
    const registerSection = document.getElementById('registerSection');
    const confirmForm = document.getElementById('confirmForm');
    const mfaForm = document.getElementById('mfaForm');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');

    // Hide all
    loginSection.classList.add('hidden');
    registerSection.classList.add('hidden');
    confirmForm.classList.add('hidden');
    mfaForm.classList.add('hidden');

    if (tab === 'login') {
        loginSection.classList.remove('hidden');
        loginTab.classList.add('bg-primary');
        loginTab.classList.remove('text-gray-400');
        registerTab.classList.remove('bg-primary');
        registerTab.classList.add('text-gray-400');
    } else if (tab === 'register') {
        registerSection.classList.remove('hidden');
        registerTab.classList.add('bg-primary');
        registerTab.classList.remove('text-gray-400');
        loginTab.classList.remove('bg-primary');
        loginTab.classList.add('text-gray-400');
    } else if (tab === 'confirm') {
        confirmForm.classList.remove('hidden');
    } else if (tab === 'mfa') {
        mfaForm.classList.remove('hidden');
    }
}

function showLoginTab(tab) {
    const phoneForm = document.getElementById('loginPhoneForm');
    const emailForm = document.getElementById('loginEmailForm');
    const phoneTab = document.getElementById('loginPhoneTab');
    const emailTab = document.getElementById('loginEmailTab');

    if (tab === 'phone') {
        phoneForm.classList.remove('hidden');
        emailForm.classList.add('hidden');
        phoneTab.classList.add('active');
        emailTab.classList.remove('active');
    } else {
        phoneForm.classList.add('hidden');
        emailForm.classList.remove('hidden');
        phoneTab.classList.remove('active');
        emailTab.classList.add('active');
    }
}

function showRegisterTab(tab) {
    const phoneForm = document.getElementById('registerPhoneForm');
    const emailForm = document.getElementById('registerEmailForm');
    const phoneTab = document.getElementById('registerPhoneTab');
    const emailTab = document.getElementById('registerEmailTab');

    if (tab === 'phone') {
        phoneForm.classList.remove('hidden');
        emailForm.classList.add('hidden');
        phoneTab.classList.add('active');
        emailTab.classList.remove('active');
    } else {
        phoneForm.classList.add('hidden');
        emailForm.classList.remove('hidden');
        phoneTab.classList.remove('active');
        emailTab.classList.add('active');
    }
}

// ==========================================
// Phone OTP Functions (CUSTOM_AUTH Flow)
// ==========================================

async function requestLoginOtp() {
    const phone = document.getElementById('loginPhone').value;
    if (!phone) {
        showError('loginPhoneError', 'Please enter your phone number');
        return;
    }

    try {
        // Find username by phone number (user needs to be registered)
        // For now, we'll use phone as username format: phone_+919894954524
        const username = 'phone_' + phone.replace(/[^0-9]/g, '');

        // Initiate CUSTOM_AUTH flow
        const response = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
            },
            body: JSON.stringify({
                AuthFlow: 'CUSTOM_AUTH',
                ClientId: CONFIG.clientId,
                AuthParameters: {
                    USERNAME: username
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to send OTP');
        }

        // Store session for later verification
        phoneSession = data.Session;
        pendingPhone = phone;
        pendingUsername = username;

        // Show OTP input
        document.getElementById('loginOtpSection').classList.remove('hidden');
        document.getElementById('loginPhoneSubmit').classList.remove('hidden');

        showError('loginPhoneError', ''); // Clear any previous errors
        document.getElementById('loginPhoneError').classList.add('hidden');

        console.log('OTP sent! Session stored.');

    } catch (error) {
        showError('loginPhoneError', error.message);
    }
}

let pendingRole = 'ASrole'; // Store selected role

async function requestRegisterOtp() {
    const phone = document.getElementById('registerPhone').value;
    if (!phone) {
        showError('registerPhoneError', 'Please enter your phone number');
        return;
    }

    // Get selected role from the form (step 2 has role selection, but we need to check it)
    // If role is selected in step 1, use it; otherwise default will be set in step 2
    const selectedRole = document.querySelector('input[name="phoneRegisterRole"]:checked')?.value || 'ASrole';
    pendingRole = selectedRole;

    try {
        // Generate a temporary username from phone
        const tempUsername = 'phone_' + phone.replace(/[^0-9]/g, '');

        // Sign up with phone number (Cognito will send OTP)
        const response = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp'
            },
            body: JSON.stringify({
                ClientId: CONFIG.clientId,
                Username: tempUsername,
                Password: generateTempPassword(), // Generate a strong temp password
                UserAttributes: [
                    { Name: 'phone_number', Value: phone },
                    { Name: 'custom:role', Value: selectedRole } // Use selected role!
                ]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to send OTP');
        }

        // Show OTP verification section
        document.getElementById('registerOtpSection').classList.remove('hidden');
        pendingPhone = phone;
        pendingUsername = tempUsername;

    } catch (error) {
        showError('registerPhoneError', error.message);
    }
}

function generateTempPassword() {
    // Generate a strong temporary password
    return 'Temp@' + Math.random().toString(36).slice(2) + Math.random().toString(36).toUpperCase().slice(2) + '!1';
}

async function verifyRegisterOtp() {
    const code = document.getElementById('registerPhoneOtp').value;
    if (!code) {
        showError('registerPhoneError', 'Please enter the OTP');
        return;
    }

    try {
        // Confirm signup with OTP
        const response = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmSignUp'
            },
            body: JSON.stringify({
                ClientId: CONFIG.clientId,
                Username: pendingUsername,
                ConfirmationCode: code
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Invalid OTP');
        }

        // Move to step 2 (username selection)
        document.getElementById('phoneStep1').classList.add('hidden');
        document.getElementById('phoneStep2').classList.remove('hidden');

    } catch (error) {
        showError('registerPhoneError', error.message);
    }
}

// ==========================================
// Email/Password Auth Functions
// ==========================================

async function signUp(username, email, password, role) {
    const userAttributes = [
        { Name: 'email', Value: email },
        { Name: 'custom:role', Value: role || 'ASrole' }
    ];

    const response = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp'
        },
        body: JSON.stringify({
            ClientId: CONFIG.clientId,
            Username: username,
            Password: password,
            UserAttributes: userAttributes
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Sign up failed');
    }

    return await response.json();
}

async function confirmSignUp(username, code) {
    const response = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.ConfirmSignUp'
        },
        body: JSON.stringify({
            ClientId: CONFIG.clientId,
            Username: username,
            ConfirmationCode: code
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Confirmation failed');
    }

    return await response.json();
}

async function signIn(username, password) {
    const response = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
        },
        body: JSON.stringify({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: CONFIG.clientId,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || 'Sign in failed');
    }

    // Check if MFA is required
    if (data.ChallengeName === 'SMS_MFA' || data.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
        return { mfaRequired: true, session: data.Session, challengeName: data.ChallengeName };
    }

    return data.AuthenticationResult;
}

async function respondToMfaChallenge(username, mfaCode, session, challengeName) {
    const response = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge'
        },
        body: JSON.stringify({
            ChallengeName: challengeName,
            ClientId: CONFIG.clientId,
            Session: session,
            ChallengeResponses: {
                USERNAME: username,
                [challengeName === 'SMS_MFA' ? 'SMS_MFA_CODE' : 'SOFTWARE_TOKEN_MFA_CODE']: mfaCode
            }
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'MFA verification failed');
    }

    const data = await response.json();
    return data.AuthenticationResult;
}

// ==========================================
// UI Helper Functions
// ==========================================

function showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.remove('hidden');
}

function hideError(elementId) {
    const el = document.getElementById(elementId);
    el.classList.add('hidden');
}

function showAccessDenied(message) {
    const el = document.getElementById('accessDeniedMessage');
    const textEl = document.getElementById('accessDeniedText');
    textEl.textContent = message;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
}

function hideAccessDenied() {
    document.getElementById('accessDeniedMessage').classList.add('hidden');
}

function updateRoleBadges() {
    const container = document.getElementById('roleBadges');
    container.innerHTML = userRoles.map(role => {
        const color = role === 'DMrole' ? 'amber' : 'emerald';
        return `<span class="px-2 py-1 rounded-lg text-xs font-medium bg-${color}-500/20 text-${color}-400">${role}</span>`;
    }).join('');
}

function updateButtonStates() {
    const allowedOps = [];
    userRoles.forEach(role => {
        if (ROLE_PERMISSIONS[role]) {
            allowedOps.push(...ROLE_PERMISSIONS[role]);
        }
    });

    const buttons = {
        'btnDivide': 'divide',
        'btnMultiply': 'multiply',
        'btnAdd': 'add',
        'btnSubtract': 'subtract'
    };

    Object.entries(buttons).forEach(([btnId, op]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            if (allowedOps.includes(op)) {
                btn.disabled = false;
                btn.classList.remove('opacity-30');
            } else {
                btn.disabled = true;
                btn.classList.add('opacity-30');
            }
        }
    });
}

async function showCalculator() {
    userRoles = extractRolesFromToken(idToken);

    // If user is ONLY admin (no other roles), go directly to admin panel
    if (userRoles.includes('AdminRole') && userRoles.length === 1) {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('calculatorSection').classList.add('hidden');
        document.getElementById('adminSection').classList.remove('hidden');
        loadUsers();
        return;
    }

    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('calculatorSection').classList.remove('hidden');
    document.getElementById('adminSection').classList.add('hidden');
    document.getElementById('usernameDisplay').textContent = currentUser;

    // Load custom role permissions from API
    await loadRolePermissions();

    updateRoleBadges();
    updateButtonStates();

    // Show admin button if user is admin (and has other roles too)
    if (userRoles.includes('AdminRole')) {
        addAdminButton();
    }

    if (userRoles.length === 0) {
        showAccessDenied('No roles assigned. Contact admin to get a role.');
    }
}

// Load role permissions from the API (for custom roles)
async function loadRolePermissions() {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/roles`, {
            headers: { 'Authorization': idToken }
        });

        if (response.ok) {
            const data = await response.json();
            const roles = data.roles || [];

            // Update ROLE_PERMISSIONS with custom roles
            roles.forEach(role => {
                if (role.roleName && role.permissions) {
                    ROLE_PERMISSIONS[role.roleName] = role.permissions;
                }
            });

            console.log('Loaded role permissions:', ROLE_PERMISSIONS);
        }
    } catch (error) {
        console.log('Could not load custom role permissions:', error);
    }
}

function logout() {
    currentUser = null;
    idToken = null;
    userRoles = [];
    localStorage.removeItem('idToken');
    localStorage.removeItem('username');
    document.getElementById('authSection').classList.remove('hidden');
    document.getElementById('calculatorSection').classList.add('hidden');
    document.getElementById('adminSection').classList.add('hidden');
    // Remove admin button if it exists
    const adminBtn = document.getElementById('adminPanelBtn');
    if (adminBtn) adminBtn.remove();
    showMainTab('login');
}

// ==========================================
// Calculator Functions
// ==========================================

function appendNumber(num) {
    const display = document.getElementById('display');
    if (shouldResetDisplay || display.textContent === '0') {
        display.textContent = num;
        shouldResetDisplay = false;
    } else {
        display.textContent += num;
    }
}

function setOperation(op) {
    const allowedOps = [];
    userRoles.forEach(role => {
        if (ROLE_PERMISSIONS[role]) {
            allowedOps.push(...ROLE_PERMISSIONS[role]);
        }
    });

    if (!allowedOps.includes(op)) {
        const requiredRole = op === 'divide' || op === 'multiply' ? 'DMrole' : 'ASrole';
        showAccessDenied(`Access Denied: You need "${requiredRole}" to use this operation.`);
        return;
    }

    const display = document.getElementById('display');
    const expressionEl = document.getElementById('expression');

    operand1 = parseFloat(display.textContent);
    operation = op;
    shouldResetDisplay = true;

    const opSymbols = { add: '+', subtract: '−', multiply: '×', divide: '÷' };
    expressionEl.textContent = `${operand1} ${opSymbols[op]}`;
    hideAccessDenied();
}

function clearDisplay() {
    document.getElementById('display').textContent = '0';
    document.getElementById('expression').textContent = '';
    operand1 = null;
    operation = null;
    hideAccessDenied();
}

function backspace() {
    const display = document.getElementById('display');
    if (display.textContent.length > 1) {
        display.textContent = display.textContent.slice(0, -1);
    } else {
        display.textContent = '0';
    }
}

async function calculate() {
    if (operand1 === null || operation === null) return;

    const display = document.getElementById('display');
    const expressionEl = document.getElementById('expression');
    const operand2 = parseFloat(display.textContent);

    const opSymbols = { add: '+', subtract: '−', multiply: '×', divide: '÷' };
    expressionEl.textContent = `${operand1} ${opSymbols[operation]} ${operand2} =`;

    try {
        const response = await fetch(`${CONFIG.apiEndpoint}calculate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': idToken
            },
            body: JSON.stringify({
                operand1: operand1,
                operand2: operand2,
                operation: operation
            })
        });

        const data = await response.json();

        if (response.ok) {
            display.textContent = data.result;
            updateHistory(data.history);
            hideAccessDenied();

            if (data.user_roles) {
                userRoles = data.user_roles;
                updateRoleBadges();
                updateButtonStates();
            }
        } else if (response.status === 403) {
            showAccessDenied(data.error);
            display.textContent = 'Denied';
        } else {
            display.textContent = 'Error';
            console.error(data.error);
        }
    } catch (error) {
        console.warn('API call failed:', error);
        showAccessDenied('API Error: ' + error.message);
        display.textContent = 'Error';
    }

    operand1 = null;
    operation = null;
    shouldResetDisplay = true;
}

function updateHistory(history) {
    const historyList = document.getElementById('historyList');

    if (!history || history.length === 0) {
        historyList.innerHTML = '<div class="text-gray-500 text-center py-8">No calculations yet</div>';
        return;
    }

    const opSymbols = { add: '+', subtract: '−', multiply: '×', divide: '÷' };

    historyList.innerHTML = history.map(item => `
        <div class="bg-slate-800/30 rounded-xl p-4 hover:bg-slate-800/50 transition-colors">
            <div class="flex justify-between items-center">
                <span class="text-gray-400 text-sm">
                    ${item.operand1} ${opSymbols[item.operation]} ${item.operand2}
                </span>
                <span class="text-white font-medium">= ${item.result}</span>
            </div>
            <div class="text-gray-500 text-xs mt-1">${new Date(item.timestamp).toLocaleString()}</div>
        </div>
    `).join('');
}

// ==========================================
// Event Listeners
// ==========================================

// Phone Login Form - Verify OTP with CUSTOM_AUTH
document.getElementById('loginPhoneForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('loginPhoneError');

    const otp = document.getElementById('loginPhoneOtp').value;

    if (!otp || !phoneSession) {
        showError('loginPhoneError', 'Please enter the OTP sent to your phone');
        return;
    }

    try {
        // Respond to custom challenge with OTP
        const response = await fetch(`https://cognito-idp.${CONFIG.region}.amazonaws.com/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge'
            },
            body: JSON.stringify({
                ChallengeName: 'CUSTOM_CHALLENGE',
                ClientId: CONFIG.clientId,
                Session: phoneSession,
                ChallengeResponses: {
                    USERNAME: pendingUsername,
                    ANSWER: otp
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'OTP verification failed');
        }

        // Check if we got tokens (successful login)
        if (data.AuthenticationResult) {
            idToken = data.AuthenticationResult.IdToken;
            currentUser = pendingUsername;
            localStorage.setItem('idToken', idToken);
            localStorage.setItem('username', pendingUsername);
            phoneSession = null;
            showCalculator();
        } else {
            throw new Error('Unexpected response from authentication');
        }

    } catch (error) {
        showError('loginPhoneError', error.message);
    }
});

// Email Login Form
document.getElementById('loginEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('loginEmailError');

    const identifier = document.getElementById('loginIdentifier').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const result = await signIn(identifier, password);

        if (result.mfaRequired) {
            phoneSession = result.session;
            pendingUsername = identifier;
            showMainTab('mfa');
        } else {
            idToken = result.IdToken;
            currentUser = identifier;
            localStorage.setItem('idToken', idToken);
            localStorage.setItem('username', identifier);
            showCalculator();
        }
    } catch (error) {
        showError('loginEmailError', error.message);
    }
});

// MFA Form
document.getElementById('mfaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('mfaError');

    const mfaCode = document.getElementById('mfaCode').value;

    try {
        const result = await respondToMfaChallenge(pendingUsername, mfaCode, phoneSession, 'SMS_MFA');
        idToken = result.IdToken;
        currentUser = pendingUsername;
        localStorage.setItem('idToken', idToken);
        localStorage.setItem('username', pendingUsername);
        phoneSession = null;
        showCalculator();
    } catch (error) {
        showError('mfaError', error.message);
    }
});

// Phone Register Form (Final Submit)
document.getElementById('registerPhoneForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('registerPhoneError');

    const username = document.getElementById('registerPhoneUsername').value;
    const role = document.querySelector('input[name="phoneRegisterRole"]:checked')?.value || 'ASrole';

    try {
        // Update the user's preferred username (Cognito may support this via UpdateUserAttributes)
        // For now, just log in with the temp username
        showError('registerPhoneError', 'Registration complete! Please login with your phone number.');

        // Reset form and go to login
        setTimeout(() => {
            showMainTab('login');
            showLoginTab('phone');
        }, 2000);

    } catch (error) {
        showError('registerPhoneError', error.message);
    }
});

// Email Register Form
document.getElementById('registerEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('registerEmailError');

    const email = document.getElementById('registerEmail').value;
    const username = document.getElementById('registerEmailUsername').value;
    const password = document.getElementById('registerEmailPassword').value;
    const role = document.querySelector('input[name="emailRegisterRole"]:checked')?.value || 'ASrole';

    try {
        await signUp(username, email, password, role);
        pendingUsername = username;
        showMainTab('confirm');
    } catch (error) {
        showError('registerEmailError', error.message);
    }
});

// Confirm Form (Email verification)
document.getElementById('confirmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('confirmError');

    const code = document.getElementById('confirmCode').value;

    try {
        await confirmSignUp(pendingUsername, code);
        showMainTab('login');
        showLoginTab('email');
        document.getElementById('loginIdentifier').value = pendingUsername;
    } catch (error) {
        showError('confirmError', error.message);
    }
});

// Keyboard support
document.addEventListener('keydown', (e) => {
    if (document.getElementById('calculatorSection').classList.contains('hidden')) return;

    if (e.key >= '0' && e.key <= '9') appendNumber(e.key);
    else if (e.key === '.') appendNumber('.');
    else if (e.key === '+') setOperation('add');
    else if (e.key === '-') setOperation('subtract');
    else if (e.key === '*') setOperation('multiply');
    else if (e.key === '/') setOperation('divide');
    else if (e.key === 'Enter' || e.key === '=') calculate();
    else if (e.key === 'Escape') clearDisplay();
    else if (e.key === 'Backspace') backspace();
});

// Check for existing session on load
window.addEventListener('load', () => {
    const storedToken = localStorage.getItem('idToken');
    const storedUsername = localStorage.getItem('username');

    if (storedToken && storedUsername) {
        idToken = storedToken;
        currentUser = storedUsername;
        showCalculator();
    }
});

// ==========================================
// Admin Functions
// ==========================================

function isAdmin() {
    return userRoles.includes('AdminRole');
}

function addAdminButton() {
    // Check if button already exists
    if (document.getElementById('adminPanelBtn')) return;

    const header = document.querySelector('#calculatorSection .flex.items-center.justify-between');
    const adminBtn = document.createElement('button');
    adminBtn.id = 'adminPanelBtn';
    adminBtn.className = 'px-4 py-2 bg-gradient-to-r from-amber-500 to-red-500 text-white rounded-xl hover:opacity-90 transition-all flex items-center gap-2 mr-4';
    adminBtn.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z">
            </path>
        </svg>
        Admin
    `;
    adminBtn.onclick = showAdminDashboard;

    const buttonsContainer = header.querySelector('.flex.items-center.gap-4');
    buttonsContainer.insertBefore(adminBtn, buttonsContainer.firstChild);
}

function showAdminDashboard() {
    document.getElementById('calculatorSection').classList.add('hidden');
    document.getElementById('adminSection').classList.remove('hidden');
    loadUsers();
}

function showCalculatorFromAdmin() {
    document.getElementById('adminSection').classList.add('hidden');
    document.getElementById('calculatorSection').classList.remove('hidden');
}

function showAdminTab(tab) {
    const tabs = ['users', 'roles', 'history'];
    tabs.forEach(t => {
        document.getElementById(`admin${t.charAt(0).toUpperCase() + t.slice(1)}Tab`).classList.remove('bg-primary', 'text-white');
        document.getElementById(`admin${t.charAt(0).toUpperCase() + t.slice(1)}Tab`).classList.add('bg-slate-800/50', 'text-gray-300');
        document.getElementById(`admin${t.charAt(0).toUpperCase() + t.slice(1)}Panel`).classList.add('hidden');
    });

    document.getElementById(`admin${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab`).classList.add('bg-primary', 'text-white');
    document.getElementById(`admin${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab`).classList.remove('bg-slate-800/50', 'text-gray-300');
    document.getElementById(`admin${tab.charAt(0).toUpperCase() + tab.slice(1)}Panel`).classList.remove('hidden');

    if (tab === 'users') loadUsers();
    else if (tab === 'roles') loadRoles();
    else if (tab === 'history') loadAllHistory();
}

// ==========================================
// Admin API Calls
// ==========================================

let allRoles = []; // Cache for roles

async function loadUsers() {
    try {
        // Load roles first for the dropdown
        const rolesResponse = await fetch(`${CONFIG.apiEndpoint}admin/roles`, {
            headers: { 'Authorization': idToken }
        });
        if (rolesResponse.ok) {
            const rolesData = await rolesResponse.json();
            allRoles = rolesData.roles || [];
        }

        const response = await fetch(`${CONFIG.apiEndpoint}admin/users`, {
            headers: { 'Authorization': idToken }
        });
        const data = await response.json();

        if (response.ok) {
            renderUsersTable(data.users);
        } else {
            console.error('Failed to load users:', data.error);
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-gray-500">No users found</td></tr>';
        return;
    }

    // Build role options including custom roles
    const roleOptions = allRoles.map(role => role.roleName);
    // Ensure AdminRole is always included
    if (!roleOptions.includes('AdminRole')) {
        roleOptions.push('AdminRole');
    }

    tbody.innerHTML = users.map(user => {
        const optionsHtml = roleOptions.map(roleName => {
            const isSelected = user.groups.includes(roleName) ? 'selected' : '';
            return `<option value="${roleName}" ${isSelected}>${roleName}</option>`;
        }).join('');

        return `
        <tr class="border-b border-slate-700/50 hover:bg-slate-800/30">
            <td class="py-3 px-4 text-white">${user.username}</td>
            <td class="py-3 px-4 text-gray-400">${user.email || user.phone || '-'}</td>
            <td class="py-3 px-4">
                <select onchange="changeUserRole('${user.username}', this.value)" 
                    class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-white text-sm">
                    ${optionsHtml}
                </select>
            </td>
            <td class="py-3 px-4">
                <span class="px-2 py-1 rounded-lg text-xs ${user.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}">
                    ${user.enabled ? 'Active' : 'Blocked'}
                </span>
            </td>
            <td class="py-3 px-4">
                <div class="flex gap-2">
                    <button onclick="toggleBlockUser('${user.username}', ${user.enabled})"
                        class="px-3 py-1 rounded-lg text-xs ${user.enabled ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'}">
                        ${user.enabled ? 'Block' : 'Unblock'}
                    </button>
                    <button onclick="deleteUser('${user.username}')"
                        class="px-3 py-1 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30">
                        Delete
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');
}

async function changeUserRole(username, newRole) {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/users/role`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': idToken
            },
            body: JSON.stringify({ username, role: newRole })
        });

        if (response.ok) {
            loadUsers();
        } else {
            const data = await response.json();
            alert('Failed to change role: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function toggleBlockUser(username, isEnabled) {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/users/block`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': idToken
            },
            body: JSON.stringify({ username, block: isEnabled })
        });

        if (response.ok) {
            loadUsers();
        } else {
            const data = await response.json();
            alert('Failed: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function deleteUser(username) {
    if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;

    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/users`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': idToken
            },
            body: JSON.stringify({ username })
        });

        if (response.ok) {
            loadUsers();
        } else {
            const data = await response.json();
            alert('Failed: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// ==========================================
// Role Management
// ==========================================

async function loadRoles() {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/roles`, {
            headers: { 'Authorization': idToken }
        });
        const data = await response.json();

        if (response.ok) {
            renderRolesList(data.roles);
        }
    } catch (error) {
        console.error('Error loading roles:', error);
    }
}

function renderRolesList(roles) {
    const container = document.getElementById('rolesList');

    container.innerHTML = roles.map(role => `
        <div class="bg-slate-800/30 rounded-xl p-4 flex items-center justify-between">
            <div>
                <div class="flex items-center gap-2">
                    <span class="text-white font-medium">${role.roleName}</span>
                    ${role.isDefault ? '<span class="px-2 py-0.5 rounded text-xs bg-primary/20 text-primary">Default</span>' : ''}
                </div>
                <p class="text-gray-400 text-sm mt-1">
                    Permissions: ${role.permissions ? role.permissions.join(', ') : 'None'}
                </p>
            </div>
            ${!role.isDefault ? `
                <button onclick="deleteRole('${role.roleName}')"
                    class="px-3 py-1 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30">
                    Delete
                </button>
            ` : ''}
        </div>
    `).join('');
}

async function createRole() {
    const roleName = document.getElementById('newRoleName').value.trim();
    if (!roleName) {
        alert('Please enter a role name');
        return;
    }

    const permissions = [];
    if (document.getElementById('permAdd').checked) permissions.push('add');
    if (document.getElementById('permSubtract').checked) permissions.push('subtract');
    if (document.getElementById('permMultiply').checked) permissions.push('multiply');
    if (document.getElementById('permDivide').checked) permissions.push('divide');

    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/roles`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': idToken
            },
            body: JSON.stringify({ roleName, permissions })
        });

        if (response.ok) {
            document.getElementById('newRoleName').value = '';
            loadRoles();
        } else {
            const data = await response.json();
            alert('Failed: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function deleteRole(roleName) {
    if (!confirm(`Are you sure you want to delete role "${roleName}"?`)) return;

    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/roles`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': idToken
            },
            body: JSON.stringify({ roleName })
        });

        if (response.ok) {
            loadRoles();
        } else {
            const data = await response.json();
            alert('Failed: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// ==========================================
// History Management
// ==========================================

async function loadAllHistory() {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/history`, {
            headers: { 'Authorization': idToken }
        });
        const data = await response.json();

        if (response.ok) {
            renderAllHistory(data.history);
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

function renderAllHistory(history) {
    const container = document.getElementById('allHistoryList');
    const opSymbols = { add: '+', subtract: '−', multiply: '×', divide: '÷' };

    if (!history || history.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-center py-8">No history found</div>';
        return;
    }

    container.innerHTML = history.map(item => `
        <div class="bg-slate-800/30 rounded-xl p-4 flex items-center justify-between hover:bg-slate-800/50">
            <div>
                <div class="text-white">
                    ${item.operand1} ${opSymbols[item.operation] || item.operation} ${item.operand2} = ${item.result}
                </div>
                <div class="text-gray-500 text-xs mt-1">
                    User: ${item.userId} | ${new Date(item.timestamp).toLocaleString()}
                </div>
            </div>
            <button onclick="deleteHistoryEntry('${item.userId}', '${item.timestamp}')"
                class="px-3 py-1 rounded-lg text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30">
                Delete
            </button>
        </div>
    `).join('');
}

async function deleteHistoryEntry(userId, timestamp) {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}admin/history`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': idToken
            },
            body: JSON.stringify({ userId, timestamp })
        });

        if (response.ok) {
            loadAllHistory();
        }
    } catch (error) {
        console.error('Error deleting history:', error);
    }
}
