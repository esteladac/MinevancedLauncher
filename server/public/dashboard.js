const state = {
  authenticated: false,
  currentTab: 'modrinth',
  selectedMods: [],
  manifests: []
};

const el = (id) => document.getElementById(id);

function setHint(id, message, isError = false) {
  const node = el(id);
  node.textContent = message || '';
  node.style.color = isError ? '#ff9fb0' : '';
}

function showErrorModal(title, message, details = '') {
  el('error-modal-title').textContent = title || 'Something went wrong';
  el('error-modal-message').textContent = message || 'Unknown error.';
  const detailsNode = el('error-modal-details');
  if (details) {
    detailsNode.textContent = details;
    detailsNode.classList.remove('hidden');
  } else {
    detailsNode.textContent = '';
    detailsNode.classList.add('hidden');
  }
  el('error-modal').classList.remove('hidden');
}

function hideErrorModal() {
  el('error-modal').classList.add('hidden');
}

async function api(pathname, options = {}) {
  try {
    const response = await fetch(pathname, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof data === 'string' ? data : data.error || response.statusText;
      throw new Error(message);
    }

    return data;
  } catch (error) {
    if (error.name !== 'AbortError') {
      showErrorModal('Request failed', error.message, `${pathname}\n${error.stack || ''}`.trim());
    }
    throw error;
  }
}

function renderSelectedMods() {
  const container = el('selected-mods');
  if (state.selectedMods.length === 0) {
    container.innerHTML = '<div class="selected-item"><div><h4>No mods selected</h4><p>Add items from the search panel.</p></div></div>';
    return;
  }

  container.innerHTML = state.selectedMods.map((mod, index) => `
    <div class="selected-item">
      <div>
        <h4>${mod.name}</h4>
        <p>${mod.source} • ${mod.version || 'latest'} • ${mod.projectUrl ? `<a href="${mod.projectUrl}" target="_blank" rel="noreferrer">Open</a>` : 'manual'}</p>
        <small>${mod.downloadUrl || 'No download URL yet'}</small>
      </div>
      <button data-remove-mod="${index}">Remove</button>
    </div>
  `).join('');

  container.querySelectorAll('[data-remove-mod]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-remove-mod'));
      state.selectedMods.splice(index, 1);
      renderSelectedMods();
    });
  });
}

function renderManifests() {
  const container = el('manifest-list');
  if (state.manifests.length === 0) {
    container.innerHTML = '<div class="manifest-item"><h4>No manifests yet</h4><p>Create or import a pack to publish it here.</p></div>';
    return;
  }

  container.innerHTML = state.manifests.map((manifest) => `
    <div class="manifest-item">
      <h4>${manifest.name}</h4>
      <p>${manifest.description || 'No description'}</p>
      <small>ID: ${manifest.id} • MC ${manifest.minecraftVersion || 'unknown'} • ${manifest.modLoader || 'vanilla'}</small>
    </div>
  `).join('');
}

function renderSearchResults(items) {
  const container = el('search-results');
  if (!items.length) {
    container.innerHTML = '<div class="result-card"><h4>No results</h4><p>Try a different search query.</p></div>';
    return;
  }

  container.innerHTML = items.map((item) => {
    const openUrl = item.projectUrl || item.websiteUrl || item.url || '#';
    const canAdd = state.currentTab === 'modrinth' && item.projectId;
    return `
      <div class="result-card">
        <h4>${item.name}</h4>
        <p>${item.summary || item.description || 'No summary available.'}</p>
        <small>${item.author ? `By ${item.author}` : ''} ${item.version ? `• ${item.version}` : ''}</small>
        <div class="result-actions">
          <a href="${openUrl}" target="_blank" rel="noreferrer">Open</a>
          ${canAdd ? `<button data-add-mod="${item.projectId}">Add latest Modrinth version</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-add-mod]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const projectId = button.getAttribute('data-add-mod');
        const form = new FormData(el('creator-form'));
        const params = new URLSearchParams({
          projectId,
          gameVersion: form.get('minecraftVersion'),
          loader: form.get('modLoader')
        });
        const result = await api(`/api/modrinth/latest?${params.toString()}`);
        state.selectedMods.push(result.mod);
        renderSelectedMods();
      } catch (error) {
        showErrorModal('Unable to add mod', error.message, error.stack || '');
      }
    });
  });
}

async function refreshManifests() {
  try {
    const data = await api('/api/modpacks');
    state.manifests = data.modpacks || [];
    renderManifests();
  } catch (error) {
    setHint('create-hint', error.message, true);
  }
}

async function checkAuth() {
  const status = await api('/api/me');
  state.authenticated = !!status.authenticated;
  el('server-status').textContent = status.authenticated ? 'Dashboard unlocked' : 'Admin login required';
  el('auth-panel').classList.toggle('hidden', status.authenticated);
  el('dashboard').classList.toggle('hidden', !status.authenticated);
  if (status.authenticated) {
    await refreshManifests();
  }
}

async function login() {
  try {
    const password = el('admin-password').value;
    await api('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    setHint('login-hint', 'Login successful.');
    await checkAuth();
  } catch (error) {
    setHint('login-hint', error.message, true);
    showErrorModal('Login failed', error.message, error.stack || '');
  }
}

async function searchMods() {
  const query = el('search-query').value.trim();
  if (!query) {
    setHint('search-note', 'Enter a search term first.', true);
    return;
  }

  setHint('search-note', `Searching ${state.currentTab} for "${query}"...`);
  try {
    if (state.currentTab === 'modrinth') {
      const data = await api(`/api/modrinth/search?q=${encodeURIComponent(query)}`);
      renderSearchResults(data.results || []);
      setHint('search-note', `Found ${data.results?.length || 0} Modrinth result(s).`);
      return;
    }

    const data = await api(`/api/curseforge/search?q=${encodeURIComponent(query)}`);
    renderSearchResults(data.results || []);
    setHint('search-note', data.note || `Found ${data.results?.length || 0} CurseForge result(s).`);
  } catch (error) {
    setHint('search-note', error.message, true);
    renderSearchResults([]);
  }
}

async function createPack() {
  try {
    const form = new FormData(el('creator-form'));
    const payload = Object.fromEntries(form.entries());
    payload.mods = state.selectedMods;
    const data = await api('/api/modpacks/create', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setHint('create-hint', `Saved ${data.manifest.id}.json`);
    await refreshManifests();
  } catch (error) {
    setHint('create-hint', error.message, true);
    showErrorModal('Manifest creation failed', error.message, error.stack || '');
  }
}

async function importMrpack() {
  try {
    const file = el('mrpack-file').files[0];
    if (!file) {
      setHint('import-hint', 'Choose a .mrpack file first.', true);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/modpacks/import-modrinth', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || response.statusText);

    setHint('import-hint', `Imported ${data.manifest.id}.json from Modrinth pack.`);
    await refreshManifests();
  } catch (error) {
    setHint('import-hint', error.message, true);
    showErrorModal('Import failed', error.message, error.stack || '');
  }
}

async function bootstrap() {
  el('server-status').textContent = 'Checking server status...';
  try {
    const status = await api('/api/status');
    el('server-status').textContent = status.adminPasswordConfigured ? 'Server ready' : 'Server ready, admin password missing';
  } catch (error) {
    el('server-status').textContent = 'Server unavailable';
  }

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
      button.classList.add('active');
      state.currentTab = button.dataset.tab;
      el('search-note').textContent = state.currentTab === 'modrinth'
        ? 'Modrinth search uses the public API.'
        : 'CurseForge search will use the API key if configured in .env.';
    });
  });

  el('error-modal-close').addEventListener('click', hideErrorModal);
  el('error-modal-dismiss').addEventListener('click', hideErrorModal);
  el('error-modal').addEventListener('click', (event) => {
    if (event.target === el('error-modal')) hideErrorModal();
  });
  el('error-modal-copy').addEventListener('click', async () => {
    const text = [
      el('error-modal-title').textContent,
      el('error-modal-message').textContent,
      el('error-modal-details').textContent
    ].filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text);
    setHint('search-note', 'Error copied to clipboard.');
  });

  el('admin-login-btn').addEventListener('click', login);
  el('admin-password').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') login();
  });
  el('search-btn').addEventListener('click', searchMods);
  el('search-query').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchMods();
  });
  el('create-pack-btn').addEventListener('click', createPack);
  el('import-btn').addEventListener('click', importMrpack);
  el('clear-mods').addEventListener('click', () => {
    state.selectedMods = [];
    renderSelectedMods();
  });
  el('refresh-manifests').addEventListener('click', refreshManifests);

  renderSelectedMods();
  await checkAuth();

  el('search-note').textContent = 'Modrinth search uses the public API.';
}

window.addEventListener('error', (event) => {
  showErrorModal('Unhandled error', event.message, event.error?.stack || '');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Promise rejected'));
  showErrorModal('Unhandled promise rejection', reason.message, reason.stack || '');
});

bootstrap();
