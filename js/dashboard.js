// Restaurant API helpers
const restApi = {
  getToken() { return localStorage.getItem('cf_rest_token'); },
  getRestaurant() { const r = localStorage.getItem('cf_rest'); return r ? JSON.parse(r) : null; },
  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`http://localhost:5000/api${path}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Error');
    return data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); },
  put(path, body) { return this.request(path, { method: 'PUT', body: JSON.stringify(body) }); },
  delete(path) { return this.request(path, { method: 'DELETE' }); },
};

if (!restApi.getToken()) window.location.href = 'login.html';

let editingItemId = null;
let currentOrderFilter = '';
let restaurantProfile = null;

function logout() {
  localStorage.removeItem('cf_rest_token');
  localStorage.removeItem('cf_rest');
  window.location.href = 'login.html';
}

// ===== TABS =====
function showTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.textContent.toLowerCase().includes(tab)) n.classList.add('active');
  });

  if (tab === 'orders') loadOrders();
  if (tab === 'menu') loadMenu();
  if (tab === 'stats') loadStats();
  if (tab === 'settings') loadSettings();
}

// ===== INIT =====
async function init() {
  const rest = restApi.getRestaurant();
  if (!rest) return logout();

  document.getElementById('sidebarRestName').textContent = rest.name || 'Restaurant';

  try {
    restaurantProfile = await restApi.get(`/restaurants/${rest.id}`).then(r => r.restaurant);
    updateOpenStatus(restaurantProfile.isOpen);
    if (restaurantProfile.name) {
      document.getElementById('setName').value = restaurantProfile.name;
      document.getElementById('setDesc').value = restaurantProfile.description || '';
      document.getElementById('setDeliveryFee').value = restaurantProfile.deliveryFee || 500;
      document.getElementById('setMinOrder').value = restaurantProfile.minOrder || 1000;
      document.getElementById('setETA').value = restaurantProfile.estimatedDeliveryTime || 30;
    }
  } catch {}

  connectSocket(rest.id);
  loadOrders();
}

function updateOpenStatus(isOpen) {
  const dot = document.getElementById('restStatusDot');
  const text = document.getElementById('restStatusText');
  if (isOpen) {
    dot.classList.add('open');
    text.textContent = 'Open';
  } else {
    dot.classList.remove('open');
    text.textContent = 'Closed';
  }
}

// ===== SOCKET =====
function connectSocket(restaurantId) {
 const socket = io('https://chowfast-backend-production.up.railway.app');
  socket.emit('restaurant:join', restaurantId);

  socket.on('order:new', (order) => {
    playOrderSound();
    showNewOrderAlert(order);
    if (document.getElementById('tab-orders').classList.contains('active')) {
      loadOrders();
    }
  });

  socket.on('order:cancelled', () => {
    if (document.getElementById('tab-orders').classList.contains('active')) loadOrders();
  });
}

function playOrderSound() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(800, ctx.currentTime);
    o.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
    o.frequency.setValueAtTime(800, ctx.currentTime + 0.2);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch {}
}

// ===== ORDERS =====
async function loadOrders() {
  const container = document.getElementById('ordersList');
  container.innerHTML = '<div class="flex-center" style="padding:40px"><div class="spinner"></div></div>';

  try {
    let url = '/restaurants/dashboard/orders';
    if (currentOrderFilter) url += `?status=${currentOrderFilter}`;
    const orders = await restApi.get(url);

    if (orders.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:60px;color:var(--text-muted)">
          <p style="font-size:2rem">📋</p>
          <p>No orders${currentOrderFilter ? ` with status "${currentOrderFilter}"` : ''} yet</p>
        </div>`;
      return;
    }

    container.innerHTML = orders.map(order => renderOrderCard(order)).join('');
  } catch (err) {
    container.innerHTML = `<p style="color:var(--text-muted)">${err.message}</p>`;
  }
}

function renderOrderCard(order) {
  const STATUS_NEXT = {
    pending: { label: 'Confirm Order', action: 'confirmed', cls: 'confirm' },
    confirmed: { label: 'Start Preparing', action: 'preparing', cls: 'prepare' },
    preparing: { label: 'Mark Ready', action: 'ready', cls: 'ready' },
  };

  const next = STATUS_NEXT[order.status];
  const STATUS_BADGE = {
    pending: 'badge-amber', confirmed: 'badge-green', preparing: 'badge-amber',
    ready: 'badge-brand', picked_up: 'badge-brand', delivered: 'badge-green', cancelled: 'badge-red'
  };

  return `
    <div class="order-card-rest" id="order-${order._id}">
      <div class="order-card-top">
        <div>
          <div class="order-id">#${order._id.slice(-8).toUpperCase()}</div>
          <div class="order-time">${new Date(order.createdAt).toLocaleString('en-NG', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</div>
        </div>
        <span class="badge ${STATUS_BADGE[order.status] || 'badge-amber'}">${order.status.replace('_', ' ')}</span>
      </div>

      <div class="order-customer">
        👤 <strong>${order.user?.name || 'Customer'}</strong>
        ${order.user?.phone ? `· <a href="tel:${order.user.phone}" style="color:var(--green)">📞 ${order.user.phone}</a>` : ''}
      </div>

      <div class="order-items-list">
        ${order.items?.map(i => `<span>${i.name} x${i.quantity}</span>`).join('  ·  ')}
      </div>

      ${order.note ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;font-style:italic">Note: "${order.note}"</div>` : ''}

      <div class="order-card-bottom">
        <div>
          <div class="order-total-rest">₦${order.total?.toLocaleString()}</div>
          <div style="font-size:0.78rem;color:var(--text-muted)">${order.paymentMethod === 'cash' ? '💵 Cash on delivery' : '💳 Paid online'}</div>
        </div>
        <div class="order-actions">
          ${next ? `
            <button class="status-action-btn ${next.cls}" onclick="updateOrderStatus('${order._id}', '${next.action}', this)">
              ${next.label}
            </button>
          ` : ''}
          ${order.status === 'pending' ? `
            <button class="status-action-btn" style="background:rgba(255,61,61,0.1);color:var(--red);border:1px solid var(--red)"
              onclick="updateOrderStatus('${order._id}', 'cancelled', this)">
              Cancel
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

async function updateOrderStatus(orderId, status, btn) {
  btn.disabled = true;
  btn.textContent = 'Updating...';
  try {
    await restApi.put(`/restaurants/dashboard/orders/${orderId}/status`, { status });
    showToast(`Order status updated to: ${status.replace('_', ' ')}`, 'success');
    loadOrders();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = btn.textContent.replace('Updating...', 'Retry');
  }
}

// Filter buttons
document.getElementById('orderFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentOrderFilter = btn.dataset.status;
  loadOrders();
});

// ===== MENU =====
async function loadMenu() {
  const rest = restApi.getRestaurant();
  const container = document.getElementById('menuList');
  container.innerHTML = '<div class="flex-center" style="padding:40px"><div class="spinner"></div></div>';

  try {
    const items = await restApi.get(`/menu/${rest.id}`);

    if (items.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:60px;color:var(--text-muted)">
          <p style="font-size:2.5rem">🍽️</p>
          <p>No menu items yet. Add your first item!</p>
        </div>`;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="menu-item-row" id="menu-item-${item._id}">
        <div class="menu-item-img-sm">
          ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;">` : '🍽️'}
        </div>
        <div class="menu-item-details">
          <div class="menu-item-name-row">${item.name}</div>
          <div class="menu-item-cat">${item.category}</div>
        </div>
        <div class="menu-item-price-tag">₦${item.price?.toLocaleString()}</div>
        <div class="menu-item-actions">
          <button class="avail-toggle ${item.isAvailable ? 'available' : 'unavailable'}"
            onclick="toggleItemAvailability('${item._id}', this)">
            ${item.isAvailable ? 'Available' : 'Unavailable'}
          </button>
          <button class="edit-btn" onclick="openEditItemModal(${JSON.stringify(item).replace(/"/g, '&quot;')})">Edit</button>
          <button class="delete-btn" onclick="deleteMenuItem('${item._id}')">🗑</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p style="color:var(--text-muted)">${err.message}</p>`;
  }
}

async function toggleItemAvailability(itemId, btn) {
  try {
    const result = await restApi.put(`/menu/${itemId}/toggle`, {});
    if (result.isAvailable) {
      btn.className = 'avail-toggle available';
      btn.textContent = 'Available';
    } else {
      btn.className = 'avail-toggle unavailable';
      btn.textContent = 'Unavailable';
    }
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteMenuItem(itemId) {
  if (!confirm('Delete this menu item?')) return;
  try {
    await restApi.delete(`/menu/${itemId}`);
    document.getElementById(`menu-item-${itemId}`)?.remove();
    showToast('Item deleted', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

// ===== MODAL =====
function openAddItemModal() {
  editingItemId = null;
  document.getElementById('modalTitle').textContent = 'Add Menu Item';
  document.getElementById('itemName').value = '';
  document.getElementById('itemDesc').value = '';
  document.getElementById('itemPrice').value = '';
  document.getElementById('itemCategory').value = '';
  document.getElementById('itemImage').value = '';
  document.getElementById('saveItemBtn').textContent = 'Add Item';
  document.getElementById('menuModal').classList.add('open');
}

function openEditItemModal(item) {
  editingItemId = item._id;
  document.getElementById('modalTitle').textContent = 'Edit Menu Item';
  document.getElementById('itemName').value = item.name;
  document.getElementById('itemDesc').value = item.description || '';
  document.getElementById('itemPrice').value = item.price;
  document.getElementById('itemCategory').value = item.category;
  document.getElementById('itemImage').value = '';
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('saveItemBtn').textContent = 'Save Changes';
  document.getElementById('menuModal').classList.add('open');
}

function closeMenuModal() {
  document.getElementById('menuModal').classList.remove('open');
  document.getElementById('imagePreview').style.display = 'none';
  editingItemId = null;
}

// Image preview
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('itemImage').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('previewImg').src = ev.target.result;
        document.getElementById('imagePreview').style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });
});

async function saveMenuItem() {
  const name = document.getElementById('itemName').value.trim();
  const description = document.getElementById('itemDesc').value.trim();
  const price = parseFloat(document.getElementById('itemPrice').value);
  const category = document.getElementById('itemCategory').value.trim();
  const imageFile = document.getElementById('itemImage').files[0];

  if (!name || !price || !category) {
    showToast('Please fill in name, price, and category', 'error');
    return;
  }

  const btn = document.getElementById('saveItemBtn');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    const token = restApi.getToken();
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    formData.append('price', price);
    formData.append('category', category);
    if (imageFile) formData.append('image', imageFile);

    const url = editingItemId
      ? `http://localhost:5000/api/menu/${editingItemId}`
      : 'http://localhost:5000/api/menu';
    const method = editingItemId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Error');

    showToast(editingItemId ? 'Item updated!' : 'Item added!', 'success');
    closeMenuModal();
    loadMenu();
  } catch (err) { showToast(err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = editingItemId ? 'Save Changes' : 'Add Item'; }
}

// ===== TOGGLE OPEN/CLOSED =====
async function toggleRestaurantOpen() {
  try {
    const result = await restApi.put('/restaurants/profile/toggle-open', {});
    updateOpenStatus(result.isOpen);
    showToast(result.isOpen ? 'Restaurant is now Open 🟢' : 'Restaurant is now Closed 🔴', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

// ===== STATS =====
async function loadStats() {
  try {
    const stats = await restApi.get('/restaurants/dashboard/stats');
    document.getElementById('sTotalOrders').textContent = stats.totalOrders || 0;
    document.getElementById('sTodayOrders').textContent = stats.todayOrders || 0;
    document.getElementById('sRevenue').textContent = '₦' + (stats.totalRevenue || 0).toLocaleString();
  } catch {}
}

// ===== SETTINGS =====
function loadSettings() {
  // Already loaded on init
}

async function saveSettings() {
  try {
    await restApi.put('/restaurants/profile/update', {
      name: document.getElementById('setName').value.trim(),
      description: document.getElementById('setDesc').value.trim(),
      deliveryFee: parseFloat(document.getElementById('setDeliveryFee').value),
      minOrder: parseFloat(document.getElementById('setMinOrder').value),
      estimatedDeliveryTime: parseInt(document.getElementById('setETA').value),
    });
    showToast('Settings saved!', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

// ===== ALERT =====
function showNewOrderAlert(order) {
  const alert = document.getElementById('newOrderAlert');
  document.getElementById('newOrderSub').textContent =
    `₦${order.total?.toLocaleString()} · ${order.items?.length} item(s)`;
  alert.style.display = 'block';
  setTimeout(() => { alert.style.display = 'none'; }, 20000);
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.cf-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `cf-toast cf-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('cf-toast--show'), 10);
  setTimeout(() => { toast.classList.remove('cf-toast--show'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// Close modal on overlay click
document.getElementById('menuModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('menuModal')) closeMenuModal();
});

init();
