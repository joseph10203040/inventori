// ==================== WEB BLUETOOTH API ====================
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
let bleDevice = null;
let bleChar = null;

// Scan State & Smoothing Variables
let isScanningBag = false;
let itemsFoundThisScan = new Set();
let tagHistory = {};
const HISTORY_LENGTH = 3;

async function connectBluetooth() {
    try {
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'Inventori-Bag' }],
            optionalServices: [SERVICE_UUID]
        });

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        bleChar = await service.getCharacteristic(CHARACTERISTIC_UUID);

        await bleChar.startNotifications();
        bleChar.addEventListener('characteristicvaluechanged', handleIncomingTag);
        bleDevice.addEventListener('gattserverdisconnected', onBleDisconnected);

        const btn = document.getElementById('ble-connect-btn');
        btn.innerText = "\uD83D\uDD35 Bag Connected";
        btn.style.backgroundColor = "var(--success)";
        showToast("Connected to Inventori Hardware!");

    } catch (error) {
        console.error("Bluetooth Error:", error);
        showToast("Bluetooth connection failed.", true);
    }
}

function onBleDisconnected() {
    bleChar = null;
    bleDevice = null;
    const btn = document.getElementById('ble-connect-btn');
    btn.innerText = "Connect to Bag";
    btn.style.backgroundColor = "";
    showToast("Bag disconnected.", true);
}

// INTELLIGENT PARSER WITH SMOOTHING
function handleIncomingTag(event) {
    const value = new TextDecoder().decode(event.target.value);
    const parts = value.trim().split(':');
    if (parts.length !== 2) return;

    const cleanID = parts[0];
    const rawRssi = parseInt(parts[1]);

    // --- SMOOTHING ALGORITHM ---
    if (!tagHistory[cleanID]) {
        tagHistory[cleanID] = [];
    }

    tagHistory[cleanID].push(rawRssi);

    if (tagHistory[cleanID].length > HISTORY_LENGTH) {
        tagHistory[cleanID].shift();
    }

    const sum = tagHistory[cleanID].reduce((a, b) => a + b, 0);
    const avgRssi = sum / tagHistory[cleanID].length;

    // --- 1. PAIRING TAB LOGIC ---
    if (document.getElementById('view-pair').classList.contains('active')) {
        const pairThreshold = parseInt(document.getElementById('pair-range-slider').value);

        // Check against the smoothed average instead of raw RSSI
        if (avgRssi >= pairThreshold) {
            document.getElementById('pairing-active').style.display = 'none';
            document.getElementById('pairing-success').style.display = 'block';

            const titleEl = document.getElementById('pairing-status-title');
            const nameInput = document.getElementById('new-tag-name');
            document.getElementById('new-tag-id').innerText = cleanID;

            if (masterItems[cleanID]) {
                titleEl.innerText = "Tag Already Paired!";
                titleEl.style.color = "var(--primary)";
                nameInput.value = masterItems[cleanID].name;
                showToast("Tag detected. You can rename it.");
            } else {
                titleEl.innerText = "New Tag Found!";
                titleEl.style.color = "var(--success)";
                nameInput.value = '';
            }
            nameInput.focus();
        }
    }

    // --- 2. BAG SCANNING TAB LOGIC ---
    if (isScanningBag) {
        const scanThreshold = parseInt(document.getElementById('scan-range-slider').value);

        // Check against the smoothed average
        if (avgRssi >= scanThreshold) {
            itemsFoundThisScan.add(cleanID);

            const dot = document.getElementById(`status-${cleanID}`);
            if (dot && !dot.classList.contains('found')) {
                dot.classList.add('found');
                if (navigator.vibrate) navigator.vibrate(10);
            }
        }
    }
}

// ==================== LIVE BAG SCAN ====================
function renderScanList() {
    const activeProfileId = document.getElementById('profile-selector').value;
    const container = document.getElementById('scan-list');
    document.getElementById('scan-result').innerText = '';

    if (!activeProfileId || !profiles[activeProfileId]) {
        container.innerHTML = `<p class="empty-state">No bags yet. Create one in Organize.</p>`;
        return;
    }

    const activeItems = profiles[activeProfileId].items;
    container.innerHTML = '';

    if (activeItems.length === 0) {
        container.innerHTML = `<p class="empty-state">No items assigned to this bag.</p>`;
        return;
    }
    activeItems.forEach(id => {
        if (!masterItems[id]) return;
        container.innerHTML += `<div class="item-row"><span>${masterItems[id].name}</span><div class="status-dot" id="status-${id}"></div></div>`;
    });
}

function triggerScan() {
    if (!bleChar) {
        showToast("Please Connect to Bag first!", true);
        return;
    }

    const activeProfileId = document.getElementById('profile-selector').value;
    if (!activeProfileId || !profiles[activeProfileId]) return;

    const activeItems = profiles[activeProfileId].items;
    const btn = document.getElementById('scan-btn');
    const resultText = document.getElementById('scan-result');

    if (activeItems.length === 0) return;

    isScanningBag = true;
    itemsFoundThisScan.clear();

    btn.innerText = "Scanning Bag...";
    btn.disabled = true;
    document.querySelectorAll('.status-dot').forEach(el => el.className = 'status-dot');

    resultText.innerText = "Listening for tags...";
    resultText.style.color = "var(--primary)";

    // Stop reading after 4 seconds and calculate results
    setTimeout(() => {
        isScanningBag = false;
        btn.innerText = "Scan Backpack";
        btn.disabled = false;

        let missingCount = 0;
        activeItems.forEach(id => {
            const dot = document.getElementById(`status-${id}`);
            if (!dot) return;

            if (!itemsFoundThisScan.has(id)) {
                dot.classList.add('missing');
                missingCount++;
            }
        });

        if (missingCount > 0) {
            resultText.innerText = `${missingCount} Item(s) Missing!`;
            resultText.style.color = 'var(--danger)';
            showToast("Missing items detected!", true);
        } else {
            resultText.innerText = `All Items Present`;
            resultText.style.color = 'var(--success)';
            showToast("Bag is packed and ready!");
        }
    }, 4000);
}

// ==================== PERSISTENCE ====================
const STORAGE_KEY = 'inventori_data';

function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to load saved data');
    }
    return null;
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            masterItems,
            profiles,
            version: 1
        }));
    } catch (e) { }
}

function resetAllData() {
    showConfirm("WARNING: This will wipe all tags and bags from memory. Are you sure?", () => {
        localStorage.removeItem(STORAGE_KEY);
        masterItems = {};
        profiles = {};
        saveData();
        renderOrganizer();
        renderDropdown();
        renderScanList();
        showToast("All data wiped. Fresh start!");
    }, "Wipe Data");
}

// ==================== DATA STATE ====================
const saved = loadData();
let masterItems = saved ? saved.masterItems : {};
let profiles = saved ? saved.profiles : {};

for (const profile of Object.values(profiles)) {
    profile.items = profile.items.filter(id => masterItems[id]);
}

// ==================== TOAST & CONFIRM ====================
let toastTimer = null;
function showToast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    void el.offsetWidth;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2500);
}

function showConfirm(message, onConfirm, btnLabel = 'Delete') {
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-action-btn').textContent = btnLabel;
    document.getElementById('confirm-action-btn').onclick = () => {
        closeConfirm();
        onConfirm();
    };
    document.getElementById('confirm-overlay').classList.add('active');
}

function closeConfirm() {
    document.getElementById('confirm-overlay').classList.remove('active');
}

// ==================== UI HANDLERS ====================
function handleBagEnter(event) {
    if (event.key === 'Enter') { event.preventDefault(); createNewBag(); }
}

function handlePairEnter(event) {
    if (event.key === 'Enter') { event.preventDefault(); saveNewTag(); }
}

function createNewBag() {
    const inputField = document.getElementById('new-bag-input');
    const bagName = inputField.value.trim();
    if (bagName === '') return;
    const safeId = bagName.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Math.floor(Math.random() * 10000);
    profiles[safeId] = { name: bagName, items: [] };
    inputField.value = '';
    saveData();
    renderOrganizer();
    renderDropdown();
    renderScanList();
}

function deleteProfile(profileId) {
    const name = profiles[profileId].name;
    showConfirm(`Delete "${name}" and all its assignments?`, () => {
        delete profiles[profileId];
        saveData();
        renderOrganizer();
        renderDropdown();
        renderScanList();
    });
}

function isDuplicateName(newName, excludeId = null) {
    const checkName = newName.trim().toLowerCase();
    for (const [id, item] of Object.entries(masterItems)) {
        if (id !== excludeId && item.name.toLowerCase() === checkName) return true;
    }
    return false;
}

function startRename(id) {
    const nameSpan = document.getElementById('name-' + id);
    const currentName = masterItems[id].name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-rename';
    input.value = currentName;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    function commitRename() {
        const newName = input.value.trim();
        if (newName === '' || newName === currentName) {
            renderOrganizer();
            return;
        }
        if (isDuplicateName(newName, id)) {
            showToast(`Item "${newName}" already exists.`, true);
            renderOrganizer();
            return;
        }
        masterItems[id].name = newName;
        saveData();
        renderOrganizer();
        if (document.getElementById('view-scan').classList.contains('active')) renderScanList();
    }
    input.addEventListener('blur', commitRename);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { renderOrganizer(); }
    });
}

function deleteItem(id) {
    const name = masterItems[id].name;
    showConfirm(`Delete "${name}" from your library? It will be removed from all bags.`, () => {
        delete masterItems[id];
        for (const profile of Object.values(profiles)) {
            profile.items = profile.items.filter(i => i !== id);
        }
        saveData();
        renderOrganizer();
        renderDropdown();
        renderScanList();
    });
}

function switchView(viewName, navElement) {
    const leavingPair = document.getElementById('view-pair').classList.contains('active');
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + viewName).classList.add('active');
    navElement.classList.add('active');
    if (viewName === 'organize') renderOrganizer();
    if (viewName === 'scan') { renderDropdown(); renderScanList(); }
    if (leavingPair && viewName !== 'pair') {
        document.getElementById('pairing-idle').style.display = 'block';
        document.getElementById('pairing-active').style.display = 'none';
        document.getElementById('pairing-success').style.display = 'none';
    }
}

function renderDropdown() {
    const selector = document.getElementById('profile-selector');
    const currentValue = selector.value;
    selector.innerHTML = '';
    const profileKeys = Object.keys(profiles);
    if (profileKeys.length === 0) {
        selector.innerHTML = '<option value="">No bags yet</option>';
        return;
    }
    for (const [id, profile] of Object.entries(profiles)) {
        selector.innerHTML += `<option value="${id}">${profile.name}</option>`;
    }
    if (profiles[currentValue]) selector.value = currentValue;
}

function renderOrganizer() {
    const libraryContainer = document.getElementById('master-library');
    const emptyLib = document.getElementById('library-empty');
    libraryContainer.innerHTML = '';
    const itemKeys = Object.keys(masterItems);
    emptyLib.style.display = itemKeys.length === 0 ? 'block' : 'none';

    for (const [id, item] of Object.entries(masterItems)) {
        const el = document.createElement('div');
        el.className = 'master-item';
        el.draggable = true;
        el.dataset.tagId = id;
        el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', id);
            el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        el.innerHTML = `
            <span class="master-item-name" id="name-${id}">${item.name}</span>
            <span class="item-actions">
                <button class="action-btn" onclick="startRename('${id}')" title="Rename">\u270F\uFE0F</button>
                <button class="action-btn delete-item-btn" onclick="deleteItem('${id}')" title="Delete">\uD83D\uDDD1</button>
            </span>
        `;
        setupTouchDrag(el, id);
        libraryContainer.appendChild(el);
    }

    const binsContainer = document.getElementById('dynamic-bins-container');
    const emptyBins = document.getElementById('bins-empty');
    binsContainer.innerHTML = '';
    const profileKeys = Object.keys(profiles);
    emptyBins.style.display = profileKeys.length === 0 ? 'block' : 'none';

    for (const [profileId, profile] of Object.entries(profiles)) {
        let binContent = '';
        profile.items.forEach(id => {
            const itemName = masterItems[id] ? masterItems[id].name : 'Unknown';
            binContent += `<div class="bin-tag">${itemName}<span class="remove-btn" onclick="removeFromProfile('${profileId}', '${id}')">\u00D7</span></div>`;
        });
        const binDiv = document.createElement('div');
        binDiv.innerHTML = `
            <div class="bag-header">
                <div class="section-title">${profile.name}</div>
                <button class="delete-bag-btn" onclick="deleteProfile('${profileId}')" title="Delete Bag">\uD83D\uDDD1 Delete</button>
            </div>
            <div class="profile-bin" id="bin-${profileId}" data-profile-id="${profileId}">
                ${binContent}
            </div>
        `;
        binsContainer.appendChild(binDiv);

        const bin = binDiv.querySelector('.profile-bin');
        bin.addEventListener('dragover', (e) => { e.preventDefault(); bin.classList.add('drag-over'); });
        bin.addEventListener('dragleave', () => bin.classList.remove('drag-over'));
        bin.addEventListener('drop', (e) => {
            e.preventDefault();
            bin.classList.remove('drag-over');
            const tagId = e.dataTransfer.getData('text/plain');
            if (tagId && !profiles[profileId].items.includes(tagId) && masterItems[tagId]) {
                profiles[profileId].items.push(tagId);
                saveData();
                renderOrganizer();
            }
        });
    }
}

function removeFromProfile(profileId, tagId) {
    profiles[profileId].items = profiles[profileId].items.filter(id => id !== tagId);
    saveData();
    renderOrganizer();
}

let touchGhost = null;
let touchDragId = null;
function setupTouchDrag(el, tagId) {
    let longPressTimer = null, isDragging = false, startX, startY;
    el.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX; startY = e.touches[0].clientY;
        longPressTimer = setTimeout(() => {
            isDragging = true; touchDragId = tagId; el.classList.add('dragging');
            touchGhost = document.createElement('div');
            touchGhost.className = 'touch-ghost'; touchGhost.textContent = masterItems[tagId].name;
            document.body.appendChild(touchGhost);
            positionGhost(e.touches[0]);
            if (navigator.vibrate) navigator.vibrate(30);
        }, 300);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
        if (!isDragging && longPressTimer) {
            if (Math.abs(e.touches[0].clientX - startX) > 10 || Math.abs(e.touches[0].clientY - startY) > 10) {
                clearTimeout(longPressTimer); longPressTimer = null;
            }
            return;
        }
        if (!isDragging) return;
        e.preventDefault();
        positionGhost(e.touches[0]); highlightBinUnderTouch(e.touches[0]);
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer); longPressTimer = null;
        if (!isDragging) return;
        const bin = getBinUnderTouch(e.changedTouches[0]);
        if (bin && touchDragId) {
            const profileId = bin.dataset.profileId;
            if (!profiles[profileId].items.includes(touchDragId) && masterItems[touchDragId]) {
                profiles[profileId].items.push(touchDragId); saveData();
            }
        }
        cleanupTouchDrag(); isDragging = false; renderOrganizer();
    });
    el.addEventListener('touchcancel', () => { clearTimeout(longPressTimer); cleanupTouchDrag(); isDragging = false; });
}
function positionGhost(touch) { if (touchGhost) { touchGhost.style.left = (touch.clientX - 40) + 'px'; touchGhost.style.top = (touch.clientY - 40) + 'px'; } }
function highlightBinUnderTouch(touch) {
    document.querySelectorAll('.profile-bin').forEach(b => b.classList.remove('drag-over'));
    const bin = getBinUnderTouch(touch); if (bin) bin.classList.add('drag-over');
}
function getBinUnderTouch(touch) {
    if (touchGhost) touchGhost.style.display = 'none';
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (touchGhost) touchGhost.style.display = '';
    return el ? el.closest('.profile-bin') : null;
}
function cleanupTouchDrag() {
    if (touchGhost) { touchGhost.remove(); touchGhost = null; }
    touchDragId = null;
    document.querySelectorAll('.master-item.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.profile-bin.drag-over').forEach(b => b.classList.remove('drag-over'));
}

// ==================== PAIRING & SAVING ====================
function startPairing() {
    if (!bleChar) { showToast("Please Connect to Bag first!", true); return; }
    document.getElementById('pairing-idle').style.display = 'none';
    document.getElementById('pairing-active').style.display = 'flex';
}

function saveNewTag() {
    const id = document.getElementById('new-tag-id').innerText;
    const finalName = document.getElementById('new-tag-name').value.trim();

    if (!finalName) {
        showToast("Please enter a name for this item.", true);
        document.getElementById('new-tag-name').focus();
        return;
    }

    if (isDuplicateName(finalName, id)) {
        showToast(`Item "${finalName}" already exists.`, true);
        return;
    }

    masterItems[id] = { name: finalName };
    saveData();
    showToast(`"${finalName}" saved!`);
    document.getElementById('pairing-success').style.display = 'none';
    document.getElementById('pairing-idle').style.display = 'block';
    renderOrganizer();
}

// INIT
renderDropdown();
renderScanList();
renderOrganizer();
