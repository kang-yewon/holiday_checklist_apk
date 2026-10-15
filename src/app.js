/**
 * Travel Checklist Application Logic
 * Supports automatic item generation by duration, custom items,
 * independent trip persistence in localStorage, and checklist auto-saving.
 */

const STORAGE_KEY = 'holiday_checklist_trips_v1';
const DEFAULTS_STORAGE_KEY = 'holiday_checklist_defaults_v1';

const INITIAL_DEFAULTS = {
  clothesDaily: ['속옷', '양말', '상의', '하의'],
  showerBasic: ['세안제', '로션', '샴푸', '바디워시'],
  otherBasic: ['생리대']
};

// --- State Management ---
let state = {
  trips: [],
  defaults: null,
  currentTripId: null,
  activeView: 'home',
  settingsTab: 'defaults',
  
  // Create view temporary state
  createDraft: null,

  // Selected trips for deletion in settings view
  selectedTripIds: new Set(),

  // Active modal operation
  modalTarget: null,
  confirmAction: null
};

// --- Storage Utilities ---
function loadDefaults() {
  try {
    const raw = localStorage.getItem(DEFAULTS_STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(INITIAL_DEFAULTS));
    const parsed = JSON.parse(raw);
    return {
      clothesDaily: Array.isArray(parsed.clothesDaily) ? parsed.clothesDaily : [...INITIAL_DEFAULTS.clothesDaily],
      showerBasic: Array.isArray(parsed.showerBasic) ? parsed.showerBasic : [...INITIAL_DEFAULTS.showerBasic],
      otherBasic: Array.isArray(parsed.otherBasic) ? parsed.otherBasic : [...INITIAL_DEFAULTS.otherBasic]
    };
  } catch (err) {
    console.error('Failed to load defaults:', err);
    return JSON.parse(JSON.stringify(INITIAL_DEFAULTS));
  }
}

function saveDefaults() {
  try {
    localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(state.defaults));
  } catch (err) {
    console.error('Failed to save defaults:', err);
  }
}

function loadTrips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load trips from storage:', err);
    return [];
  }
}

function saveTrips() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trips));
  } catch (err) {
    console.error('Failed to save trips to storage:', err);
  }
}

// --- Generator Functions ---
function createDefaultDailyClothes(day, templateList) {
  const items = templateList || (state.defaults ? state.defaults.clothesDaily : INITIAL_DEFAULTS.clothesDaily);
  return items.map((itemName, idx) => ({
    id: `c-${day}-${idx}-${Date.now()}-${Math.random()}`,
    name: itemName,
    checked: false,
    isCustom: false
  }));
}

function syncClothesForNights(clothesData, nights, templateList) {
  const daily = { ...(clothesData.daily || {}) };
  // Ensure days 1..nights exist
  for (let d = 1; d <= nights; d++) {
    if (!daily[d] || daily[d].length === 0) {
      daily[d] = createDefaultDailyClothes(d, templateList);
    }
  }
  // Remove days > nights
  Object.keys(daily).forEach(key => {
    if (Number(key) > nights) {
      delete daily[key];
    }
  });

  return {
    daily,
    custom: Array.isArray(clothesData.custom) ? clothesData.custom : []
  };
}

function syncTowelsForNights(existingTowels = [], nights) {
  const towels = [...existingTowels];
  // If we have fewer towels than nights, add more
  while (towels.length < nights) {
    const towelNum = towels.length + 1;
    towels.push({
      id: `shower-towel-${towelNum}-${Date.now()}-${Math.random()}`,
      name: `수건 ${towelNum}`,
      checked: false,
      isTowel: true
    });
  }
  // If we have more towels than nights, slice
  if (towels.length > nights) {
    return towels.slice(0, nights);
  }
  return towels;
}

function generateNewTripDraft(name = '', nights = 2) {
  const safeNights = Math.max(1, parseInt(nights, 10) || 1);
  const days = safeNights + 1;
  const defaults = state.defaults || loadDefaults();

  // Initialize Clothes using current defaults
  const clothes = syncClothesForNights({ daily: {}, custom: [] }, safeNights, defaults.clothesDaily);

  // Initialize Shower using current defaults
  const showerBasic = (defaults.showerBasic || []).map((itemName, idx) => ({
    id: `sb-${idx}-${Date.now()}-${Math.random()}`,
    name: itemName,
    checked: false
  }));
  const showerTowels = syncTowelsForNights([], safeNights);

  // Initialize Other using current defaults
  const otherBasic = (defaults.otherBasic || []).map((itemName, idx) => ({
    id: `ob-${idx}-${Date.now()}-${Math.random()}`,
    name: itemName,
    checked: false
  }));

  return {
    id: `trip-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: name.trim(),
    nights: safeNights,
    days: days,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    items: {
      clothes: {
        daily: clothes.daily,
        custom: []
      },
      shower: {
        basic: showerBasic,
        towels: showerTowels,
        custom: []
      },
      other: {
        basic: otherBasic,
        custom: []
      }
    }
  };
}

// --- Calculation Helpers ---
function calculateProgress(trip) {
  let total = 0;
  let checked = 0;

  if (!trip || !trip.items) return { total: 0, checked: 0, percentage: 0 };

  // Clothes
  if (trip.items.clothes) {
    if (trip.items.clothes.daily) {
      Object.values(trip.items.clothes.daily).forEach(list => {
        list.forEach(i => {
          total++;
          if (i.checked) checked++;
        });
      });
    }
    if (trip.items.clothes.custom) {
      trip.items.clothes.custom.forEach(i => {
        total++;
        if (i.checked) checked++;
      });
    }
  }

  // Shower
  if (trip.items.shower) {
    ['basic', 'towels', 'custom'].forEach(sub => {
      const list = trip.items.shower[sub] || [];
      list.forEach(i => {
        total++;
        if (i.checked) checked++;
      });
    });
  }

  // Other
  if (trip.items.other) {
    ['basic', 'custom'].forEach(sub => {
      const list = trip.items.other[sub] || [];
      list.forEach(i => {
        total++;
        if (i.checked) checked++;
      });
    });
  }

  const percentage = total > 0 ? Math.round((checked / total) * 100) : 0;
  return { total, checked, percentage };
}

// --- Toast Feedback ---
function showToast(message, duration = 2200) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast._timeout);
  showToast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

// --- View Navigation ---
function switchView(viewId) {
  state.activeView = viewId;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  if (viewId === 'home') {
    renderHomeView();
  } else if (viewId === 'settings') {
    renderSettingsView();
  }
}

// ============================================================
// 1. HOME VIEW
// ============================================================
function renderHomeView() {
  const container = document.getElementById('trip-cards-container');
  const emptyState = document.getElementById('empty-state');
  const badge = document.getElementById('trip-count-badge');

  badge.textContent = `${state.trips.length}개`;

  if (state.trips.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  container.innerHTML = '';

  state.trips.forEach(trip => {
    const { total, checked, percentage } = calculateProgress(trip);
    const card = document.createElement('div');
    card.className = 'trip-card';
    card.innerHTML = `
      <div class="trip-card-header">
        <h3 class="trip-card-title">${escapeHtml(trip.name || '무제 여행')}</h3>
        <span class="badge badge-blue">${trip.nights}박 ${trip.days}일</span>
      </div>
      <div class="trip-card-footer">
        <div class="progress-info">
          <span>준비율</span>
          <span style="font-weight: 700; color: ${percentage === 100 ? '#059669' : '#2563EB'}">
            ${checked} / ${total} 완료 (${percentage}%)
          </span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${percentage}%"></div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      openDetailView(trip.id);
    });

    container.appendChild(card);
  });
}

// ============================================================
// 2. CREATE VIEW
// ============================================================
function openCreateView() {
  const defaultNights = 2;
  state.createDraft = generateNewTripDraft('', defaultNights);

  const nameInput = document.getElementById('create-trip-name');
  nameInput.value = '';

  const nightsInput = document.getElementById('create-trip-nights');
  nightsInput.value = defaultNights;

  updateCreateDurationDisplay(defaultNights);
  updateChipSelection(defaultNights);
  renderCreateCategories();

  switchView('create');
}

function updateCreateDurationDisplay(nights) {
  const safeNights = Math.max(1, parseInt(nights, 10) || 1);
  const days = safeNights + 1;
  document.getElementById('create-duration-calc').textContent = `${safeNights}박 → ${days}일`;
  document.getElementById('create-duration-summary').textContent = `(${safeNights}박 ${days}일 여행)`;

  if (state.createDraft) {
    state.createDraft.nights = safeNights;
    state.createDraft.days = days;
    state.createDraft.items.clothes = syncClothesForNights(state.createDraft.items.clothes, safeNights, state.defaults.clothesDaily);
    state.createDraft.items.shower.towels = syncTowelsForNights(state.createDraft.items.shower.towels, safeNights);
  }
}

function updateChipSelection(nights) {
  document.querySelectorAll('.chip-btn').forEach(btn => {
    const chipNights = parseInt(btn.dataset.nights, 10);
    if (chipNights === nights) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function handleCreateNightsChange(newNights) {
  const safeNights = Math.max(1, Math.min(90, parseInt(newNights, 10) || 1));
  document.getElementById('create-trip-nights').value = safeNights;
  updateCreateDurationDisplay(safeNights);
  updateChipSelection(safeNights);
  renderCreateCategories();
}

function renderCreateCategories() {
  const container = document.getElementById('create-categories-container');
  if (!container || !state.createDraft) return;

  container.innerHTML = '';
  renderCategorySection(container, state.createDraft, true);
}

// Render generic category block (used by both Create and Detail)
function renderCategorySection(container, trip, isCreate) {
  const items = trip.items;

  // 1. 👕 옷 Category
  const clothesCard = document.createElement('div');
  clothesCard.className = 'category-card';
  
  let clothesContentHtml = '';
  // Daily clothes
  const nights = trip.nights;
  for (let d = 1; d <= nights; d++) {
    const dailyItems = (items.clothes.daily && items.clothes.daily[d]) || [];
    clothesContentHtml += `
      <div class="day-group">
        <div class="day-group-title">${d}박</div>
        <div class="items-grid" data-cat="clothes" data-sub="daily" data-day="${d}">
          ${dailyItems.map(item => renderItemRowHtml(item, false)).join('')}
        </div>
      </div>
    `;
  }

  // Custom clothes ('기타' area inside clothes)
  const customClothes = (items.clothes.custom) || [];
  clothesContentHtml += `
    <div class="day-group">
      <div class="day-group-title">기타 옷</div>
      <div class="items-grid" data-cat="clothes" data-sub="custom">
        ${customClothes.map(item => renderItemRowHtml(item, true)).join('')}
      </div>
      <button type="button" class="btn-add-item btn-action-add" data-cat="clothes" data-sub="custom">
        <span>+ 옷 추가</span>
      </button>
    </div>
  `;

  clothesCard.innerHTML = `
    <div class="category-header">
      <h3 class="category-title"><span>👕</span> 옷</h3>
      <span class="category-stats">${countItemsInGroup(items.clothes)}개</span>
    </div>
    ${clothesContentHtml}
  `;
  container.appendChild(clothesCard);

  // 2. 🛁 샤워도구 Category
  const showerCard = document.createElement('div');
  showerCard.className = 'category-card';

  const basicShower = items.shower.basic || [];
  const towels = items.shower.towels || [];
  const customShower = items.shower.custom || [];

  showerCard.innerHTML = `
    <div class="category-header">
      <h3 class="category-title"><span>🛁</span> 샤워도구</h3>
      <span class="category-stats">${countItemsInShower(items.shower)}개</span>
    </div>
    <div class="day-group">
      <div class="day-group-title">기본 세면도구</div>
      <div class="items-grid" data-cat="shower" data-sub="basic">
        ${basicShower.map(item => renderItemRowHtml(item, false)).join('')}
      </div>
    </div>
    <div class="day-group">
      <div class="day-group-title">수건 (${towels.length}개)</div>
      <div class="items-grid" data-cat="shower" data-sub="towels">
        ${towels.map(item => renderItemRowHtml(item, false)).join('')}
      </div>
    </div>
    <div class="day-group">
      <div class="day-group-title">추가 세면도구</div>
      <div class="items-grid" data-cat="shower" data-sub="custom">
        ${customShower.map(item => renderItemRowHtml(item, true)).join('')}
      </div>
      <button type="button" class="btn-add-item btn-action-add" data-cat="shower" data-sub="custom">
        <span>+ 샤워도구 추가</span>
      </button>
    </div>
  `;
  container.appendChild(showerCard);

  // 3. 🎵 기타 Category
  const otherCard = document.createElement('div');
  otherCard.className = 'category-card';

  const basicOther = items.other.basic || [];
  const customOther = items.other.custom || [];

  otherCard.innerHTML = `
    <div class="category-header">
      <h3 class="category-title"><span>🎵</span> 기타</h3>
      <span class="category-stats">${basicOther.length + customOther.length}개</span>
    </div>
    <div class="day-group">
      <div class="day-group-title">기본 물품</div>
      <div class="items-grid" data-cat="other" data-sub="basic">
        ${basicOther.map(item => renderItemRowHtml(item, true)).join('')}
      </div>
    </div>
    <div class="day-group">
      <div class="day-group-title">추가 물품</div>
      <div class="items-grid" data-cat="other" data-sub="custom">
        ${customOther.map(item => renderItemRowHtml(item, true)).join('')}
      </div>
      <button type="button" class="btn-add-item btn-action-add" data-cat="other" data-sub="custom">
        <span>+ 기타 물품 추가</span>
      </button>
    </div>
  `;
  container.appendChild(otherCard);

  // Bind item row events
  bindCategoryEvents(container, trip, isCreate);
}

function countItemsInGroup(clothes) {
  let count = (clothes.custom || []).length;
  if (clothes.daily) {
    Object.values(clothes.daily).forEach(list => count += list.length);
  }
  return count;
}

function countItemsInShower(shower) {
  return (shower.basic || []).length + (shower.towels || []).length + (shower.custom || []).length;
}

function renderItemRowHtml(item, isEditable) {
  const isChecked = Boolean(item.checked);
  return `
    <div class="check-item-row ${isChecked ? 'checked' : ''}" data-id="${item.id}">
      <label class="check-item-label">
        <input type="checkbox" class="app-checkbox item-checkbox" data-id="${item.id}" ${isChecked ? 'checked' : ''}>
        <span class="check-item-text">${escapeHtml(item.name)}</span>
      </label>
      <div class="item-action-btns">
        ${isEditable ? `
          <button type="button" class="item-mini-btn btn-item-edit" data-id="${item.id}" title="수정">✎</button>
          <button type="button" class="item-mini-btn delete btn-item-delete" data-id="${item.id}" title="삭제">✕</button>
        ` : ''}
      </div>
    </div>
  `;
}

function bindCategoryEvents(container, trip, isCreate) {
  // Checkbox toggle
  container.querySelectorAll('.item-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      const checked = e.target.checked;
      toggleItemChecked(trip, id, checked, isCreate);
    });
  });

  // Add buttons
  container.querySelectorAll('.btn-action-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const cat = btn.dataset.cat;
      const sub = btn.dataset.sub;
      openItemModal('add', cat, sub, null, isCreate);
    });
  });

  // Edit buttons
  container.querySelectorAll('.btn-item-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = btn.dataset.id;
      const itemInfo = findItemById(trip, id);
      if (itemInfo) {
        openItemModal('edit', itemInfo.category, itemInfo.subType, itemInfo.item, isCreate);
      }
    });
  });

  // Delete buttons
  container.querySelectorAll('.btn-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = btn.dataset.id;
      deleteItemById(trip, id, isCreate);
    });
  });
}

function findItemById(trip, id) {
  const items = trip.items;
  // Clothes daily
  if (items.clothes && items.clothes.daily) {
    for (const [day, list] of Object.entries(items.clothes.daily)) {
      const found = list.find(i => i.id === id);
      if (found) return { category: 'clothes', subType: 'daily', day, item: found };
    }
  }
  // Clothes custom
  if (items.clothes && items.clothes.custom) {
    const found = items.clothes.custom.find(i => i.id === id);
    if (found) return { category: 'clothes', subType: 'custom', item: found };
  }
  // Shower
  if (items.shower) {
    for (const sub of ['basic', 'towels', 'custom']) {
      const found = (items.shower[sub] || []).find(i => i.id === id);
      if (found) return { category: 'shower', subType: sub, item: found };
    }
  }
  // Other
  if (items.other) {
    for (const sub of ['basic', 'custom']) {
      const found = (items.other[sub] || []).find(i => i.id === id);
      if (found) return { category: 'other', subType: sub, item: found };
    }
  }
  return null;
}

function toggleItemChecked(trip, id, checked, isCreate) {
  const itemInfo = findItemById(trip, id);
  if (itemInfo) {
    itemInfo.item.checked = checked;
    trip.updatedAt = Date.now();

    // Toggle strikethrough visual
    const row = document.querySelector(`.check-item-row[data-id="${id}"]`);
    if (row) {
      if (checked) {
        row.classList.add('checked');
      } else {
        row.classList.remove('checked');
      }
    }

    if (!isCreate) {
      saveTrips();
      updateDetailProgress(trip);
    }
  }
}

function deleteItemById(trip, id, isCreate) {
  const itemInfo = findItemById(trip, id);
  if (!itemInfo) return;

  const items = trip.items;
  if (itemInfo.category === 'clothes') {
    if (itemInfo.subType === 'custom') {
      items.clothes.custom = items.clothes.custom.filter(i => i.id !== id);
    }
  } else if (itemInfo.category === 'shower') {
    items.shower[itemInfo.subType] = items.shower[itemInfo.subType].filter(i => i.id !== id);
  } else if (itemInfo.category === 'other') {
    items.other[itemInfo.subType] = items.other[itemInfo.subType].filter(i => i.id !== id);
  }

  trip.updatedAt = Date.now();
  if (isCreate) {
    renderCreateCategories();
  } else {
    saveTrips();
    renderDetailCategories(trip);
    updateDetailProgress(trip);
  }
  showToast('항목이 삭제되었습니다.');
}

// Save from Create View
function handleSaveNewChecklist() {
  const saveBtn = document.getElementById('btn-save-checklist');
  if (saveBtn.disabled) return;

  const nameInput = document.getElementById('create-trip-name');
  let tripName = nameInput.value.trim();

  const nightsInput = document.getElementById('create-trip-nights');
  const nights = Math.max(1, parseInt(nightsInput.value, 10) || 1);

  if (!tripName) {
    tripName = `${nights}박 ${nights + 1}일 여행`;
  }

  // Prevent double click
  saveBtn.disabled = true;
  saveBtn.style.opacity = '0.7';

  state.createDraft.name = tripName;
  state.createDraft.nights = nights;
  state.createDraft.days = nights + 1;
  state.createDraft.createdAt = Date.now();
  state.createDraft.updatedAt = Date.now();

  // Add to top of trips list
  state.trips.unshift(state.createDraft);
  saveTrips();

  showToast(`'${tripName}' 체크리스트가 저장되었습니다!`);

  setTimeout(() => {
    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
    switchView('home');
  }, 250);
}

// ============================================================
// 3. DETAIL VIEW
// ============================================================
function openDetailView(tripId) {
  const trip = state.trips.find(t => t.id === tripId);
  if (!trip) {
    showToast('여행 정보를 찾을 수 없습니다.');
    switchView('home');
    return;
  }

  state.currentTripId = tripId;
  document.getElementById('detail-trip-name').textContent = trip.name;
  document.getElementById('detail-duration-badge').textContent = `${trip.nights}박 ${trip.days}일`;
  document.getElementById('detail-nights-display').textContent = `${trip.nights}박`;

  renderDetailCategories(trip);
  updateDetailProgress(trip);

  switchView('detail');
}

function renderDetailCategories(trip) {
  const container = document.getElementById('detail-categories-container');
  if (!container) return;
  container.innerHTML = '';
  renderCategorySection(container, trip, false);
}

function updateDetailProgress(trip) {
  const { total, checked, percentage } = calculateProgress(trip);
  const ratioEl = document.getElementById('detail-progress-ratio');
  const barEl = document.getElementById('detail-progress-bar');

  if (ratioEl) ratioEl.textContent = `${checked} / ${total} (${percentage}%)`;
  if (barEl) barEl.style.width = `${percentage}%`;
}

function handleDetailNightsChange(delta) {
  const trip = state.trips.find(t => t.id === state.currentTripId);
  if (!trip) return;

  const newNights = Math.max(1, Math.min(90, trip.nights + delta));
  if (newNights === trip.nights) return;

  trip.nights = newNights;
  trip.days = newNights + 1;
  const existingDay1 = trip.items.clothes && trip.items.clothes.daily && trip.items.clothes.daily[1];
  const templateList = existingDay1 ? existingDay1.map(i => i.name) : (state.defaults ? state.defaults.clothesDaily : INITIAL_DEFAULTS.clothesDaily);
  trip.items.clothes = syncClothesForNights(trip.items.clothes, newNights, templateList);
  trip.items.shower.towels = syncTowelsForNights(trip.items.shower.towels, newNights);
  trip.updatedAt = Date.now();

  document.getElementById('detail-duration-badge').textContent = `${trip.nights}박 ${trip.days}일`;
  document.getElementById('detail-nights-display').textContent = `${trip.nights}박`;

  saveTrips();
  renderDetailCategories(trip);
  updateDetailProgress(trip);
  showToast(`여행 기간이 ${trip.nights}박 ${trip.days}일로 변경되었습니다.`);
}

// ============================================================
// 4. SETTINGS VIEW
// ============================================================
function switchSettingsTab(tab) {
  state.settingsTab = tab;
  const btnDefaults = document.getElementById('tab-btn-defaults');
  const btnTrips = document.getElementById('tab-btn-trips');
  const panelDefaults = document.getElementById('settings-panel-defaults');
  const panelTrips = document.getElementById('settings-panel-trips');
  const footer = document.getElementById('settings-footer');

  if (tab === 'defaults') {
    if (btnDefaults) btnDefaults.classList.add('active');
    if (btnTrips) btnTrips.classList.remove('active');
    if (panelDefaults) panelDefaults.classList.add('active');
    if (panelTrips) panelTrips.classList.remove('active');
    if (footer) footer.classList.add('hidden');
    renderSettingsDefaults();
  } else {
    if (btnTrips) btnTrips.classList.add('active');
    if (btnDefaults) btnDefaults.classList.remove('active');
    if (panelTrips) panelTrips.classList.add('active');
    if (panelDefaults) panelDefaults.classList.remove('active');
    if (footer) footer.classList.remove('hidden');
    renderSettingsTrips();
  }
}

function renderSettingsView() {
  switchSettingsTab(state.settingsTab || 'defaults');
}

function renderSettingsDefaults() {
  if (!state.defaults) state.defaults = loadDefaults();

  // 1. Clothes
  const clothesList = document.getElementById('default-clothes-list');
  const clothesCount = document.getElementById('default-clothes-count');
  if (clothesCount) clothesCount.textContent = `${state.defaults.clothesDaily.length}개`;
  if (clothesList) {
    clothesList.innerHTML = state.defaults.clothesDaily.map((item, idx) => `
      <div class="default-item-row" data-cat="clothesDaily" data-idx="${idx}">
        <span class="default-item-name">${escapeHtml(item)}</span>
        <div class="item-action-btns">
          <button type="button" class="item-mini-btn btn-default-edit" data-cat="clothesDaily" data-idx="${idx}" title="수정">✎</button>
          <button type="button" class="item-mini-btn delete btn-default-delete" data-cat="clothesDaily" data-idx="${idx}" title="삭제">✕</button>
        </div>
      </div>
    `).join('');
  }

  // 2. Shower
  const showerList = document.getElementById('default-shower-list');
  const showerCount = document.getElementById('default-shower-count');
  if (showerCount) showerCount.textContent = `${state.defaults.showerBasic.length}개`;
  if (showerList) {
    showerList.innerHTML = state.defaults.showerBasic.map((item, idx) => `
      <div class="default-item-row" data-cat="showerBasic" data-idx="${idx}">
        <span class="default-item-name">${escapeHtml(item)}</span>
        <div class="item-action-btns">
          <button type="button" class="item-mini-btn btn-default-edit" data-cat="showerBasic" data-idx="${idx}" title="수정">✎</button>
          <button type="button" class="item-mini-btn delete btn-default-delete" data-cat="showerBasic" data-idx="${idx}" title="삭제">✕</button>
        </div>
      </div>
    `).join('');
  }

  // 3. Other
  const otherList = document.getElementById('default-other-list');
  const otherCount = document.getElementById('default-other-count');
  if (otherCount) otherCount.textContent = `${state.defaults.otherBasic.length}개`;
  if (otherList) {
    otherList.innerHTML = state.defaults.otherBasic.map((item, idx) => `
      <div class="default-item-row" data-cat="otherBasic" data-idx="${idx}">
        <span class="default-item-name">${escapeHtml(item)}</span>
        <div class="item-action-btns">
          <button type="button" class="item-mini-btn btn-default-edit" data-cat="otherBasic" data-idx="${idx}" title="수정">✎</button>
          <button type="button" class="item-mini-btn delete btn-default-delete" data-cat="otherBasic" data-idx="${idx}" title="삭제">✕</button>
        </div>
      </div>
    `).join('');
  }

  // Bind edit buttons
  document.querySelectorAll('.btn-default-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const idx = parseInt(btn.dataset.idx, 10);
      const curName = state.defaults[cat][idx];
      openDefaultItemModal('edit', cat, idx, curName);
    });
  });

  // Bind delete buttons
  document.querySelectorAll('.btn-default-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const idx = parseInt(btn.dataset.idx, 10);
      const curName = state.defaults[cat][idx];
      confirmDeleteDefaultItem(cat, idx, curName);
    });
  });
}

function openDefaultItemModal(mode, categoryKey, itemIndex, currentName) {
  state.modalTarget = { isDefault: true, mode, categoryKey, itemIndex };

  const modal = document.getElementById('modal-item');
  const title = document.getElementById('modal-item-title');
  const subtitle = document.getElementById('modal-item-subtitle');
  const input = document.getElementById('input-modal-item-name');

  const catLabels = {
    clothesDaily: '기본 옷 항목',
    showerBasic: '기본 샤워도구 항목',
    otherBasic: '기본 기타 물품'
  };
  const label = catLabels[categoryKey] || '기본 물품';

  if (mode === 'add') {
    title.textContent = `${label} 추가`;
    subtitle.textContent = '새 여행 체크리스트 생성 시 기본으로 포함될 물품 이름을 입력하세요.';
    input.value = '';
  } else {
    title.textContent = `${label} 수정`;
    subtitle.textContent = '변경할 기본 물품 이름을 입력하세요.';
    input.value = currentName || '';
  }

  modal.classList.remove('hidden');
  setTimeout(() => {
    input.focus();
  }, 100);
}

function confirmDeleteDefaultItem(categoryKey, itemIndex, itemName) {
  state.confirmAction = () => {
    state.defaults[categoryKey].splice(itemIndex, 1);
    saveDefaults();
    renderSettingsDefaults();
    showToast(`'${itemName}' 기본 항목이 삭제되었습니다.`);
    closeConfirmModal();
  };
  openConfirmModal(`'${itemName}' 기본 항목을 삭제하시겠습니까?<br><small style="color:#64748B;">이후 새로 생성되는 여행 체크리스트에서는 이 항목이 생성되지 않습니다.</small>`);
}

function confirmResetDefaults() {
  state.confirmAction = () => {
    state.defaults = JSON.parse(JSON.stringify(INITIAL_DEFAULTS));
    saveDefaults();
    renderSettingsDefaults();
    showToast('기본 물품 목록이 앱 초기 상태로 복원되었습니다.');
    closeConfirmModal();
  };
  openConfirmModal(`모든 기본 물품 항목을 앱 초기 설정으로 되돌리시겠습니까?<br><small style="color:#64748B;">기존에 저장된 여행에는 영향을 주지 않습니다.</small>`);
}

function renderSettingsTrips() {
  const container = document.getElementById('settings-trip-list');
  const emptyState = document.getElementById('settings-empty-state');
  const selectAllCb = document.getElementById('checkbox-select-all');

  state.selectedTripIds.clear();
  selectAllCb.checked = false;
  updateDeleteBtnState();

  if (state.trips.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  container.innerHTML = '';

  state.trips.forEach(trip => {
    const row = document.createElement('div');
    row.className = 'settings-trip-row';
    row.dataset.id = trip.id;
    row.innerHTML = `
      <input type="checkbox" class="app-checkbox trip-select-cb" data-id="${trip.id}">
      <div class="settings-trip-info">
        <span class="settings-trip-name">${escapeHtml(trip.name)}</span>
        <span class="settings-trip-sub">${trip.nights}박 ${trip.days}일</span>
      </div>
      <button type="button" class="item-mini-btn delete btn-single-delete" data-id="${trip.id}" title="삭제">✕</button>
    `;

    // Row selection toggle
    const cb = row.querySelector('.trip-select-cb');
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) {
        state.selectedTripIds.add(trip.id);
      } else {
        state.selectedTripIds.delete(trip.id);
      }
      updateDeleteBtnState();
    });

    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (e.target !== cb) {
        cb.checked = !cb.checked;
        if (cb.checked) {
          state.selectedTripIds.add(trip.id);
        } else {
          state.selectedTripIds.delete(trip.id);
        }
        updateDeleteBtnState();
      }
    });

    // Single delete button
    const singleDelete = row.querySelector('.btn-single-delete');
    singleDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedTripIds.clear();
      state.selectedTripIds.add(trip.id);
      state.confirmAction = () => executeTripDeletion();
      openConfirmModal(`'${trip.name}' 여행을 삭제하시겠습니까?`);
    });

    container.appendChild(row);
  });
}

function updateDeleteBtnState() {
  const count = state.selectedTripIds.size;
  const deleteBtn = document.getElementById('btn-delete-selected');
  const countBadge = document.getElementById('selected-delete-count');
  const selectAllCb = document.getElementById('checkbox-select-all');

  countBadge.textContent = `${count}개 선택`;
  deleteBtn.disabled = count === 0;

  if (state.trips.length > 0 && count === state.trips.length) {
    selectAllCb.checked = true;
  } else {
    selectAllCb.checked = false;
  }
}

function handleSelectAllToggle(checked) {
  const checkboxes = document.querySelectorAll('.trip-select-cb');
  if (checked) {
    state.trips.forEach(t => state.selectedTripIds.add(t.id));
    checkboxes.forEach(cb => cb.checked = true);
  } else {
    state.selectedTripIds.clear();
    checkboxes.forEach(cb => cb.checked = false);
  }
  updateDeleteBtnState();
}

function executeTripDeletion() {
  if (state.selectedTripIds.size === 0) return;

  const count = state.selectedTripIds.size;
  state.trips = state.trips.filter(t => !state.selectedTripIds.has(t.id));
  state.selectedTripIds.clear();
  saveTrips();

  showToast(`${count}개의 여행이 삭제되었습니다.`);
  closeConfirmModal();
  renderSettingsTrips();
}

// ============================================================
// 5. MODALS
// ============================================================
function openItemModal(mode, category, subType, item, isCreate) {
  state.modalTarget = { mode, category, subType, itemId: item ? item.id : null, isCreate };

  const modal = document.getElementById('modal-item');
  const title = document.getElementById('modal-item-title');
  const subtitle = document.getElementById('modal-item-subtitle');
  const input = document.getElementById('input-modal-item-name');

  const catNames = { clothes: '옷', shower: '샤워도구', other: '기타 물품' };
  const catLabel = catNames[category] || '물품';

  if (mode === 'add') {
    title.textContent = `${catLabel} 추가`;
    subtitle.textContent = `새로 준비할 ${catLabel}의 이름을 입력하세요.`;
    input.value = '';
  } else {
    title.textContent = `${catLabel} 수정`;
    subtitle.textContent = '변경할 물품 이름을 입력하세요.';
    input.value = item ? item.name : '';
  }

  modal.classList.remove('hidden');
  setTimeout(() => {
    input.focus();
  }, 100);
}

function closeItemModal() {
  document.getElementById('modal-item').classList.add('hidden');
  state.modalTarget = null;
}

function handleItemModalConfirm() {
  const input = document.getElementById('input-modal-item-name');
  const name = input.value.trim();
  if (!name) {
    showToast('물품 이름을 입력해주세요.');
    input.focus();
    return;
  }

  if (!state.modalTarget) return;

  // Handle default item add / edit
  if (state.modalTarget.isDefault) {
    const { mode, categoryKey, itemIndex } = state.modalTarget;
    if (mode === 'add') {
      state.defaults[categoryKey].push(name);
      saveDefaults();
      showToast(`'${name}' 기본 항목이 추가되었습니다.`);
    } else if (mode === 'edit' && itemIndex !== undefined) {
      state.defaults[categoryKey][itemIndex] = name;
      saveDefaults();
      showToast('기본 항목이 수정되었습니다.');
    }
    closeItemModal();
    renderSettingsDefaults();
    return;
  }

  const { mode, category, subType, itemId, isCreate } = state.modalTarget;
  const currentTrip = isCreate ? state.createDraft : state.trips.find(t => t.id === state.currentTripId);
  if (!currentTrip) return;

  if (mode === 'add') {
    const newItem = {
      id: `${category}-${Date.now()}-${Math.random()}`,
      name: name,
      checked: false,
      isCustom: true
    };
    if (category === 'clothes') {
      currentTrip.items.clothes.custom.push(newItem);
    } else if (category === 'shower') {
      currentTrip.items.shower.custom.push(newItem);
    } else if (category === 'other') {
      currentTrip.items.other.custom.push(newItem);
    }
    showToast(`'${name}' 항목이 추가되었습니다.`);
  } else if (mode === 'edit' && itemId) {
    const itemInfo = findItemById(currentTrip, itemId);
    if (itemInfo) {
      itemInfo.item.name = name;
      showToast('물품 이름이 수정되었습니다.');
    }
  }

  currentTrip.updatedAt = Date.now();
  closeItemModal();

  if (isCreate) {
    renderCreateCategories();
  } else {
    saveTrips();
    renderDetailCategories(currentTrip);
    updateDetailProgress(currentTrip);
  }
}

function openConfirmModal(message) {
  const modal = document.getElementById('modal-confirm');
  const msgEl = document.getElementById('modal-confirm-message');
  if (message) {
    msgEl.innerHTML = message;
  }
  modal.classList.remove('hidden');
}

function closeConfirmModal() {
  document.getElementById('modal-confirm').classList.add('hidden');
  state.confirmAction = null;
}

function executeConfirmProceed() {
  if (typeof state.confirmAction === 'function') {
    const action = state.confirmAction;
    state.confirmAction = null;
    action();
  } else {
    executeTripDeletion();
  }
}

// Utility: HTML escape
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// INITIALIZATION & EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Load saved data
  state.trips = loadTrips();
  state.defaults = loadDefaults();

  // --- Home Screen Listeners ---
  document.getElementById('btn-start').addEventListener('click', openCreateView);
  document.getElementById('btn-open-settings').addEventListener('click', () => switchView('settings'));

  // --- Create Screen Listeners ---
  document.getElementById('btn-create-back').addEventListener('click', () => switchView('home'));
  document.getElementById('btn-save-checklist').addEventListener('click', handleSaveNewChecklist);

  const nightsInput = document.getElementById('create-trip-nights');
  nightsInput.addEventListener('input', (e) => {
    handleCreateNightsChange(e.target.value);
  });

  document.getElementById('btn-nights-minus').addEventListener('click', () => {
    const current = parseInt(nightsInput.value, 10) || 1;
    if (current > 1) handleCreateNightsChange(current - 1);
  });

  document.getElementById('btn-nights-plus').addEventListener('click', () => {
    const current = parseInt(nightsInput.value, 10) || 1;
    handleCreateNightsChange(current + 1);
  });

  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nights = parseInt(btn.dataset.nights, 10);
      handleCreateNightsChange(nights);
    });
  });

  // --- Detail Screen Listeners ---
  document.getElementById('btn-detail-back').addEventListener('click', () => switchView('home'));
  document.getElementById('btn-detail-nights-minus').addEventListener('click', () => handleDetailNightsChange(-1));
  document.getElementById('btn-detail-nights-plus').addEventListener('click', () => handleDetailNightsChange(1));

  // --- Settings Screen Listeners ---
  document.getElementById('btn-settings-back').addEventListener('click', () => switchView('home'));
  document.getElementById('tab-btn-defaults').addEventListener('click', () => switchSettingsTab('defaults'));
  document.getElementById('tab-btn-trips').addEventListener('click', () => switchSettingsTab('trips'));

  document.getElementById('btn-add-default-clothes').addEventListener('click', () => openDefaultItemModal('add', 'clothesDaily'));
  document.getElementById('btn-add-default-shower').addEventListener('click', () => openDefaultItemModal('add', 'showerBasic'));
  document.getElementById('btn-add-default-other').addEventListener('click', () => openDefaultItemModal('add', 'otherBasic'));
  document.getElementById('btn-reset-defaults').addEventListener('click', confirmResetDefaults);

  document.getElementById('checkbox-select-all').addEventListener('change', (e) => {
    handleSelectAllToggle(e.target.checked);
  });
  document.getElementById('btn-delete-selected').addEventListener('click', () => {
    if (state.selectedTripIds.size > 0) {
      state.confirmAction = () => executeTripDeletion();
      openConfirmModal(`선택한 ${state.selectedTripIds.size}개의 여행을 삭제하시겠습니까?<br>삭제된 체크리스트는 복구할 수 없습니다.`);
    }
  });

  // --- Modal Listeners ---
  document.getElementById('btn-modal-cancel').addEventListener('click', closeItemModal);
  document.getElementById('btn-modal-confirm').addEventListener('click', handleItemModalConfirm);
  document.getElementById('input-modal-item-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleItemModalConfirm();
    if (e.key === 'Escape') closeItemModal();
  });

  document.getElementById('btn-confirm-cancel').addEventListener('click', closeConfirmModal);
  document.getElementById('btn-confirm-proceed').addEventListener('click', executeConfirmProceed);

  // Initial render
  renderHomeView();
});
