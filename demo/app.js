const API_URL = 'http://localhost:8080/v1';

// State
let token = null;
let orgId = null;
let sandboxApiKey = null;

// DOM Elements
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');

const orgNameEl = document.getElementById('org-name');
const orgAvatarEl = document.getElementById('org-avatar');
const policyListEl = document.getElementById('policy-list');
const policyCountEl = document.getElementById('policy-count');

const checkBtn = document.getElementById('check-code-btn');
const codeEditor = document.getElementById('code-editor');
const roleSelect = document.getElementById('sandbox-role');
const resultsContainer = document.getElementById('results-container');

// Event Listeners
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginBtn.classList.add('loading');

    try {
        // 1. Login
        const loginRes = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: emailInput.value,
                password: passwordInput.value
            })
        });

        if (!loginRes.ok) throw new Error('Invalid credentials');
        const loginData = await loginRes.json();
        token = loginData.token;

        // 2. Get Me (to find Org ID)
        const meRes = await fetch(`${API_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const meData = await meRes.json();
        
        const membership = meData.user.memberships[0];
        if (!membership) throw new Error('No organization found');
        
        orgId = membership.org.id;
        orgNameEl.textContent = membership.org.name;
        orgAvatarEl.textContent = membership.org.name.charAt(0).toUpperCase();

        // 3. Generate Temporary API Key for Sandbox
        const keyRes = await fetch(`${API_URL}/orgs/${orgId}/api-keys`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: 'Sandbox Session Key' })
        });
        
        if (keyRes.ok) {
            const keyData = await keyRes.json();
            sandboxApiKey = keyData.key;
        }

        // Transition to Dashboard
        loginContainer.classList.remove('active');
        dashboardContainer.classList.add('active');
        
        loadPolicies();

    } catch (err) {
        loginError.textContent = err.message;
    } finally {
        loginBtn.classList.remove('loading');
    }
});

async function loadPolicies() {
    try {
        const res = await fetch(`${API_URL}/orgs/${orgId}/policies`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        const policies = data.policies;
        policyCountEl.textContent = policies.length;
        
        if (policies.length === 0) {
            policyListEl.innerHTML = '<p style="color:var(--text-secondary);font-size:0.9rem;text-align:center;">No policies configured.</p>';
            return;
        }

        policyListEl.innerHTML = policies.map(p => `
            <div class="policy-item">
                <div class="policy-header">
                    <span class="policy-name">${p.name}</span>
                    <span class="severity ${p.severity}">${p.severity}</span>
                </div>
                <div class="policy-desc">${p.rule}</div>
            </div>
        `).join('');

    } catch (err) {
        policyListEl.innerHTML = '<p class="error-msg">Failed to load policies.</p>';
    }
}

checkBtn.addEventListener('click', async () => {
    if (!sandboxApiKey) {
        alert('Sandbox API Key failed to generate. Cannot run check.');
        return;
    }

    const content = codeEditor.value || codeEditor.placeholder;
    const roleName = roleSelect.value;

    checkBtn.classList.add('loading');
    resultsContainer.classList.remove('active');

    try {
        const res = await fetch(`${API_URL}/orgs/${orgId}/check`, {
            method: 'POST',
            headers: {
                'x-api-key': sandboxApiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: 'code',
                content: content,
                roleName: roleName,
                filePath: 'src/app.js'
            })
        });

        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error || 'Check failed');

        renderResults(data);
    } catch (err) {
        resultsContainer.innerHTML = `<div class="result-banner fail">Error: ${err.message}</div>`;
        resultsContainer.classList.add('active');
    } finally {
        checkBtn.classList.remove('loading');
    }
});

function renderResults(data) {
    let html = '';
    
    if (data.passed) {
        html += `<div class="result-banner success">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            Code complies with all active policies for this role.
        </div>`;
    } else {
        html += `<div class="result-banner fail">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            Found ${data.violations.length} policy violation(s).
        </div>`;

        data.violations.forEach(v => {
            html += `
                <div class="violation">
                    <div class="violation-title">${v.policyName} <span style="color:var(--text-secondary);font-size:0.75rem;margin-left:8px">(via ${v.setByDisplayName})</span></div>
                    <div class="violation-fix">
                        <span>💡 Suggestion:</span> ${v.fixSuggestion}
                    </div>
                </div>
            `;
        });
    }

    resultsContainer.innerHTML = html;
    resultsContainer.classList.add('active');
}

document.getElementById('logout-btn').addEventListener('click', (e) => {
    e.preventDefault();
    token = null;
    orgId = null;
    sandboxApiKey = null;
    dashboardContainer.classList.remove('active');
    loginContainer.classList.add('active');
    codeEditor.value = '';
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('active');
});
