// ==========================================
// Configuration - UPDATE THESE AFTER CDK DEPLOY
// ==========================================
const CONFIG = {
    // Replace these values with outputs from `cdk deploy`
    userPoolId: 'YOUR_USER_POOL_ID',
    clientId: 'YOUR_CLIENT_ID',
    apiEndpoint: 'YOUR_API_ENDPOINT',
    region: 'us-east-1'
};

// ==========================================
// State
// ==========================================
let currentUser = null;
let idToken = null;
let operand1 = null;
let operation = null;
let shouldResetDisplay = false;

// ==========================================
// Authentication Functions
// ==========================================

async function signUp(username, email, password) {
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
            UserAttributes: [
                { Name: 'email', Value: email }
            ]
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
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Sign in failed');
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
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    
    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        confirmForm.classList.add('hidden');
        loginTab.classList.add('bg-primary');
        loginTab.classList.remove('text-gray-400');
        loginTab.classList.add('text-white');
        registerTab.classList.remove('bg-primary');
        registerTab.classList.add('text-gray-400');
        registerTab.classList.remove('text-white');
    } else if (tab === 'register') {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        confirmForm.classList.add('hidden');
        registerTab.classList.add('bg-primary');
        registerTab.classList.remove('text-gray-400');
        registerTab.classList.add('text-white');
        loginTab.classList.remove('bg-primary');
        loginTab.classList.add('text-gray-400');
        loginTab.classList.remove('text-white');
    } else if (tab === 'confirm') {
        loginForm.classList.add('hidden');
        registerForm.classList.add('hidden');
        confirmForm.classList.remove('hidden');
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

function showCalculator() {
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('calculatorSection').classList.remove('hidden');
    document.getElementById('usernameDisplay').textContent = currentUser;
}

function logout() {
    currentUser = null;
    idToken = null;
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
    const display = document.getElementById('display');
    const expressionEl = document.getElementById('expression');
    
    operand1 = parseFloat(display.textContent);
    operation = op;
    shouldResetDisplay = true;
    
    const opSymbols = { add: '+', subtract: '−', multiply: '×', divide: '÷' };
    expressionEl.textContent = `${operand1} ${opSymbols[op]}`;
}

function clearDisplay() {
    document.getElementById('display').textContent = '0';
    document.getElementById('expression').textContent = '';
    operand1 = null;
    operation = null;
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
        } else {
            display.textContent = 'Error';
            console.error(data.error);
        }
    } catch (error) {
        // Fallback to local calculation if API fails
        console.warn('API call failed, using local calculation:', error);
        let result;
        switch (operation) {
            case 'add': result = operand1 + operand2; break;
            case 'subtract': result = operand1 - operand2; break;
            case 'multiply': result = operand1 * operand2; break;
            case 'divide': result = operand2 !== 0 ? operand1 / operand2 : 'Error'; break;
        }
        display.textContent = result;
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
        idToken = result.IdToken;
        currentUser = username;
        localStorage.setItem('idToken', idToken);
        localStorage.setItem('username', username);
        showCalculator();
    } catch (error) {
        showError('loginError', error.message);
    }
});

let pendingUsername = '';

document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('registerError');
    
    const email = document.getElementById('registerEmail').value;
    const username = document.getElementById('registerUsername').value;
    const password = document.getElementById('registerPassword').value;
    
    try {
        await signUp(username, email, password);
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
