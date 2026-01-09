// ==========================================
// Configuration - UPDATE THESE AFTER CDK DEPLOY
// ==========================================
const CONFIG = {
    // Replace these values with outputs from `cdk deploy`
    userPoolId: 'ap-south-1_gGlWTKaqc',
    clientId: '56gkngtgqvsolk1h8md78dlq1g',
    apiEndpoint: 'https://psuppjaqkl.execute-api.ap-south-1.amazonaws.com/prod/',
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
let mfaSession = null;
let pendingUsername = '';

// Role permissions
const ROLE_PERMISSIONS = {
    'DMrole': ['divide', 'multiply'],
    'ASrole': ['add', 'subtract']
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

    // Cognito groups are in cognito:groups claim
    const groups = payload['cognito:groups'] || [];
    return Array.isArray(groups) ? groups : [groups];
}

// ==========================================
// Authentication Functions
// ==========================================

async function signUp(username, email, password, phone) {
    const userAttributes = [
        { Name: 'email', Value: email }
    ];

    if (phone) {
        userAttributes.push({ Name: 'phone_number', Value: phone });
    }

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

function showTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const confirmForm = document.getElementById('confirmForm');
    const mfaForm = document.getElementById('mfaForm');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');

    // Hide all forms first
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
    confirmForm.classList.add('hidden');
    mfaForm.classList.add('hidden');

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        loginTab.classList.add('bg-primary');
        loginTab.classList.remove('text-gray-400');
        loginTab.classList.add('text-white');
        registerTab.classList.remove('bg-primary');
        registerTab.classList.add('text-gray-400');
        registerTab.classList.remove('text-white');
    } else if (tab === 'register') {
        registerForm.classList.remove('hidden');
        registerTab.classList.add('bg-primary');
        registerTab.classList.remove('text-gray-400');
        registerTab.classList.add('text-white');
        loginTab.classList.remove('bg-primary');
        loginTab.classList.add('text-gray-400');
        loginTab.classList.remove('text-white');
    } else if (tab === 'confirm') {
        confirmForm.classList.remove('hidden');
    } else if (tab === 'mfa') {
        mfaForm.classList.remove('hidden');
    }
}

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
    // Get user's allowed operations
    const allowedOps = [];
    userRoles.forEach(role => {
        if (ROLE_PERMISSIONS[role]) {
            allowedOps.push(...ROLE_PERMISSIONS[role]);
        }
    });

    // Update button states
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

function showCalculator() {
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('calculatorSection').classList.remove('hidden');
    document.getElementById('usernameDisplay').textContent = currentUser;

    // Extract roles from token and update UI
    userRoles = extractRolesFromToken(idToken);
    updateRoleBadges();
    updateButtonStates();

    // Show warning if no roles assigned
    if (userRoles.length === 0) {
        showAccessDenied('No roles assigned to your account. Contact admin to get DMrole or ASrole.');
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
    showTab('login');
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
    // Check if user has permission for this operation
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

            // Update roles if returned
            if (data.user_roles) {
                userRoles = data.user_roles;
                updateRoleBadges();
                updateButtonStates();
            }
        } else if (response.status === 403) {
            // Access denied - role check failed
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

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('loginError');

    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const result = await signIn(username, password);

        if (result.mfaRequired) {
            // MFA is required
            mfaSession = result.session;
            pendingUsername = username;
            showTab('mfa');
        } else {
            // Login successful
            idToken = result.IdToken;
            currentUser = username;
            localStorage.setItem('idToken', idToken);
            localStorage.setItem('username', username);
            showCalculator();
        }
    } catch (error) {
        showError('loginError', error.message);
    }
});

document.getElementById('mfaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('mfaError');

    const mfaCode = document.getElementById('mfaCode').value;

    try {
        const result = await respondToMfaChallenge(pendingUsername, mfaCode, mfaSession, 'SMS_MFA');
        idToken = result.IdToken;
        currentUser = pendingUsername;
        localStorage.setItem('idToken', idToken);
        localStorage.setItem('username', pendingUsername);
        mfaSession = null;
        showCalculator();
    } catch (error) {
        showError('mfaError', error.message);
    }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('registerError');

    const email = document.getElementById('registerEmail').value;
    const phone = document.getElementById('registerPhone')?.value || '';
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;

    try {
        await signUp(username, email, password, phone);
        pendingUsername = username;
        showTab('confirm');
    } catch (error) {
        showError('registerError', error.message);
    }
});

document.getElementById('confirmForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('confirmError');

    const code = document.getElementById('confirmCode').value;

    try {
        await confirmSignUp(pendingUsername, code);
        showTab('login');
        document.getElementById('loginUsername').value = pendingUsername;
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

// Check for existing session
window.addEventListener('load', () => {
    const storedToken = localStorage.getItem('idToken');
    const storedUsername = localStorage.getItem('username');

    if (storedToken && storedUsername) {
        idToken = storedToken;
        currentUser = storedUsername;
        showCalculator();
    }
});
