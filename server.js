const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.APP_DATA_DIR || path.join(ROOT_DIR, 'data');
const UPLOAD_DIR = process.env.APP_UPLOAD_DIR || path.join(ROOT_DIR, 'uploads');
const DB_FILE = process.env.APP_DB_FILE || path.join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_AGE_MS = SESSION_AGE_SECONDS * 1000;
const MONTH_MS = 1000 * 60 * 60 * 24 * 30;
const DEFAULT_SITE = {
  name: 'LinkCanvas',
  tagline: 'A vivid affiliate storefront for bold product curators',
  subheading:
    'Showcase your best affiliate products, turn clicks into commissions, and manage vendor access from one polished dashboard.',
  planPriceUsd: 0.99,
  freeTrialDays: 90,
  accentLabel: 'Curated drops. Instant redirects. Simple billing.',
};

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        {
          site: { ...DEFAULT_SITE },
          users: [],
          products: [],
          sessions: [],
        },
        null,
        2,
      ),
    );
  }
}

function normalizeDb(db) {
  return {
    site: {
      ...DEFAULT_SITE,
      ...(db.site || {}),
    },
    users: Array.isArray(db.users) ? db.users : [],
    products: Array.isArray(db.products) ? db.products : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : [],
  };
}

function loadDb() {
  ensureStorage();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  const db = normalizeDb(JSON.parse(raw));
  const now = Date.now();
  const nextSessions = db.sessions.filter((session) => {
    const expiresAt = Date.parse(session.expiresAt || '');
    return Number.isFinite(expiresAt) && expiresAt > now;
  });

  if (nextSessions.length !== db.sessions.length) {
    db.sessions = nextSessions;
    saveDb(db);
  }

  return db;
}

function saveDb(db) {
  ensureStorage();
  fs.writeFileSync(DB_FILE, JSON.stringify(normalizeDb(db), null, 2));
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, cookie) => {
      const separatorIndex = cookie.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }
      const key = cookie.slice(0, separatorIndex);
      const value = cookie.slice(separatorIndex + 1);
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getSessionRecord(req, db) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token) {
    return null;
  }

  return db.sessions.find((session) => session.token === token) || null;
}

function getCurrentUser(req, db) {
  const session = getSessionRecord(req, db);
  if (!session) {
    return null;
  }

  return db.users.find((user) => user.id === session.userId) || null;
}

function createSession(db, userId) {
  const token = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_AGE_MS).toISOString();
  db.sessions = db.sessions.filter((session) => session.userId !== userId);
  db.sessions.push({
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  });
  return token;
}

function clearSession(db, req) {
  const session = getSessionRecord(req, db);
  if (!session) {
    return;
  }
  db.sessions = db.sessions.filter((entry) => entry.token !== session.token);
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_AGE_SECONDS}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

function readBody(req, limit = 7 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.length) {
    return {};
  }
  return JSON.parse(body.toString('utf8'));
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function cleanText(value, maxLength = 240) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function cleanMultiline(value, maxLength = 1200) {
  return String(value || '').trim().slice(0, maxLength);
}

function validHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) {
    return false;
  }
  const attempt = crypto.scryptSync(password, user.passwordSalt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

function getOwner(db) {
  return db.users.find((user) => user.role === 'owner') || null;
}

function getPlanState(user, site) {
  const now = Date.now();

  if (user.role === 'owner') {
    return {
      type: 'owner',
      label: 'Owner access',
      canPublish: true,
      trialEndsAt: null,
      subscriptionEndsAt: null,
      daysLeft: null,
      priceUsd: Number(site.planPriceUsd),
      freeTrialDays: Number(site.freeTrialDays),
      reason: 'You control the entire platform.',
      isAccountActive: true,
    };
  }

  const accountActive = user.isActive !== false;
  const trialEndsAt = user.trialEndsAt || new Date(Date.parse(user.createdAt) + Number(site.freeTrialDays) * 86400000).toISOString();
  const trialEndMs = Date.parse(trialEndsAt);
  const subscriptionEndMs = Date.parse(user.subscriptionEndsAt || '');
  const trialActive = Number.isFinite(trialEndMs) && now <= trialEndMs;
  const subscriptionActive = Number.isFinite(subscriptionEndMs) && now <= subscriptionEndMs;
  const canPublish = accountActive && (trialActive || subscriptionActive);
  let type = 'expired';
  let label = 'Subscription required';
  let daysLeft = 0;
  let reason = 'Your trial ended. Start the $0.99 plan to publish and keep products live.';

  if (!accountActive) {
    type = 'suspended';
    label = 'Account paused';
    reason = 'The owner has disabled this account.';
  } else if (trialActive) {
    type = 'trial';
    label = 'Free trial active';
    daysLeft = Math.max(1, Math.ceil((trialEndMs - now) / 86400000));
    reason = `${daysLeft} day${daysLeft === 1 ? '' : 's'} left before the paid plan starts.`;
  } else if (subscriptionActive) {
    type = 'paid';
    label = 'Subscription active';
    daysLeft = Math.max(1, Math.ceil((subscriptionEndMs - now) / 86400000));
    reason = `Your publishing access is active for ${daysLeft} more day${daysLeft === 1 ? '' : 's'}.`;
  }

  return {
    type,
    label,
    canPublish,
    trialEndsAt,
    subscriptionEndsAt: Number.isFinite(subscriptionEndMs) ? user.subscriptionEndsAt : null,
    daysLeft,
    priceUsd: Number(site.planPriceUsd),
    freeTrialDays: Number(site.freeTrialDays),
    reason,
    isAccountActive: accountActive,
  };
}

function serializeUser(user, site) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    isActive: user.isActive !== false,
    plan: getPlanState(user, site),
  };
}

function getUserMap(db) {
  return db.users.reduce((acc, user) => {
    acc[user.id] = user;
    return acc;
  }, {});
}

function canProductBeVisible(product, db) {
  if (product.status !== 'published') {
    return false;
  }

  const owner = db.users.find((user) => user.id === product.userId);
  if (!owner) {
    return false;
  }

  return getPlanState(owner, db.site).canPublish;
}

function serializeProduct(product, db, { includePrivate = false } = {}) {
  const user = db.users.find((entry) => entry.id === product.userId);
  if (!user) {
    return null;
  }

  const payload = {
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category,
    priceLabel: product.priceLabel,
    imageUrl: product.imageUrl,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    featured: Boolean(product.featured),
    status: product.status,
    clicks: Number(product.clicks || 0),
    ownerName: user.name,
    ownerEmail: user.email,
    ownerRole: user.role,
    redirectUrl: `/go/${product.id}`,
    isLive: canProductBeVisible(product, db),
  };

  if (includePrivate) {
    payload.affiliateUrl = product.affiliateUrl;
    payload.userId = product.userId;
  }

  return payload;
}

function buildBootstrapPayload(db, user) {
  const publicProducts = db.products
    .filter((product) => canProductBeVisible(product, db))
    .sort((a, b) => {
      if (Boolean(b.featured) !== Boolean(a.featured)) {
        return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
      }
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    })
    .map((product) => serializeProduct(product, db))
    .filter(Boolean);

  const payload = {
    setupRequired: !getOwner(db),
    site: db.site,
    publicProducts,
    currentUser: user ? serializeUser(user, db.site) : null,
    dashboard: null,
    admin: null,
  };

  if (!user) {
    return payload;
  }

  const ownProducts = db.products
    .filter((product) => (user.role === 'owner' ? true : product.userId === user.id))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
    .map((product) => serializeProduct(product, db, { includePrivate: true }))
    .filter(Boolean);

  payload.dashboard = {
    plan: getPlanState(user, db.site),
    products: ownProducts,
  };

  if (user.role === 'owner') {
    const userMap = getUserMap(db);
    payload.admin = {
      users: db.users
        .slice()
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .map((entry) => serializeUser(entry, db.site)),
      products: db.products
        .slice()
        .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
        .map((product) => serializeProduct(product, db, { includePrivate: true }))
        .filter(Boolean),
      totals: {
        totalUsers: db.users.length,
        activeVendors: db.users.filter((entry) => entry.role === 'vendor' && getPlanState(entry, db.site).canPublish).length,
        liveProducts: db.products.filter((entry) => canProductBeVisible(entry, db)).length,
        totalClicks: db.products.reduce((sum, product) => sum + Number(product.clicks || 0), 0),
      },
      ownersById: Object.keys(userMap).reduce((acc, key) => {
        acc[key] = userMap[key].name;
        return acc;
      }, {}),
    };
  }

  return payload;
}

function requireAuth(req, res, db) {
  const user = getCurrentUser(req, db);
  if (!user) {
    sendError(res, 401, 'Please log in first.');
    return null;
  }
  return user;
}

function requireOwnerRole(res, user) {
  if (user.role !== 'owner') {
    sendError(res, 403, 'Only the owner can perform this action.');
    return false;
  }
  return true;
}

function safeNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function getRenewalStart(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? Math.max(Date.now(), parsed) : Date.now();
}

function writeImageFromDataUrl(dataUrl, originalName = 'product') {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Please upload a PNG, JPG, GIF, or WEBP image.');
  }

  const mime = match[1];
  const base64 = match[2];
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error('Images must be 5MB or smaller.');
  }

  const extMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const ext = extMap[mime] || 'png';
  const baseName = cleanText(path.parse(originalName).name || 'product', 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'product';
  const fileName = `${Date.now()}-${baseName}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const destination = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(destination, bytes);
  return `/uploads/${fileName}`;
}

function deleteImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('/uploads/')) {
    return;
  }

  const target = path.resolve(path.join(ROOT_DIR, imageUrl.slice(1)));
  if (!target.startsWith(path.resolve(UPLOAD_DIR))) {
    return;
  }

  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

async function handleBootstrap(req, res) {
  const db = loadDb();
  const user = getCurrentUser(req, db);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleSetupOwner(req, res) {
  const db = loadDb();
  if (getOwner(db)) {
    sendError(res, 400, 'The owner account already exists.');
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendError(res, 400, 'Invalid JSON payload.');
    return;
  }

  const name = cleanText(body.name, 80);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  if (!name || !email || !password) {
    sendError(res, 400, 'Name, email, and password are required.');
    return;
  }

  if (password.length < 8) {
    sendError(res, 400, 'Use a password with at least 8 characters.');
    return;
  }

  const { salt, hash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    role: 'owner',
    createdAt: new Date().toISOString(),
    isActive: true,
    passwordSalt: salt,
    passwordHash: hash,
  };

  db.users.push(user);
  const token = createSession(db, user.id);
  saveDb(db);
  setSessionCookie(res, token);
  sendJson(res, 201, buildBootstrapPayload(db, user));
}

async function handleSignup(req, res) {
  const db = loadDb();
  if (!getOwner(db)) {
    sendError(res, 400, 'Create the owner account before signing up vendors.');
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendError(res, 400, 'Invalid JSON payload.');
    return;
  }

  const name = cleanText(body.name, 80);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  if (!name || !email || !password) {
    sendError(res, 400, 'Name, email, and password are required.');
    return;
  }

  if (password.length < 8) {
    sendError(res, 400, 'Use a password with at least 8 characters.');
    return;
  }

  if (db.users.some((user) => user.email === email)) {
    sendError(res, 409, 'That email is already registered.');
    return;
  }

  const { salt, hash } = hashPassword(password);
  const now = Date.now();
  const freeTrialDays = Number(db.site.freeTrialDays);
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    role: 'vendor',
    createdAt: new Date(now).toISOString(),
    isActive: true,
    trialEndsAt: new Date(now + freeTrialDays * 86400000).toISOString(),
    subscriptionEndsAt: null,
    passwordSalt: salt,
    passwordHash: hash,
  };

  db.users.push(user);
  const token = createSession(db, user.id);
  saveDb(db);
  setSessionCookie(res, token);
  sendJson(res, 201, buildBootstrapPayload(db, user));
}

async function handleLogin(req, res) {
  const db = loadDb();
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendError(res, 400, 'Invalid JSON payload.');
    return;
  }

  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const user = db.users.find((entry) => entry.email === email);

  if (!user || !verifyPassword(password, user)) {
    sendError(res, 401, 'Incorrect email or password.');
    return;
  }

  const token = createSession(db, user.id);
  saveDb(db);
  setSessionCookie(res, token);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleLogout(req, res) {
  const db = loadDb();
  clearSession(db, req);
  saveDb(db);
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

async function handleSaveProduct(req, res) {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) {
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendError(res, 400, 'Invalid JSON payload.');
    return;
  }

  const plan = getPlanState(user, db.site);
  if (!plan.canPublish) {
    sendError(res, 403, plan.reason);
    return;
  }

  const title = cleanText(body.title, 100);
  const category = cleanText(body.category, 60);
  const priceLabel = cleanText(body.priceLabel, 40);
  const description = cleanMultiline(body.description, 700);
  const affiliateUrl = String(body.affiliateUrl || '').trim();
  const status = body.status === 'draft' ? 'draft' : 'published';
  const editingId = body.id ? String(body.id) : null;

  if (!title || !description || !affiliateUrl) {
    sendError(res, 400, 'Title, description, and affiliate link are required.');
    return;
  }

  if (!validHttpUrl(affiliateUrl)) {
    sendError(res, 400, 'Affiliate links must start with http:// or https://');
    return;
  }

  let product = null;
  if (editingId) {
    product = db.products.find((entry) => entry.id === editingId);
    if (!product) {
      sendError(res, 404, 'Product not found.');
      return;
    }
    if (user.role !== 'owner' && product.userId !== user.id) {
      sendError(res, 403, 'You can only edit your own products.');
      return;
    }
  }

  let imageUrl = product?.imageUrl || '';
  if (body.imageData) {
    try {
      const uploadedUrl = writeImageFromDataUrl(body.imageData, body.imageName || title);
      if (imageUrl && imageUrl !== uploadedUrl) {
        deleteImage(imageUrl);
      }
      imageUrl = uploadedUrl;
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
  }

  if (!imageUrl) {
    sendError(res, 400, 'Please upload a product image.');
    return;
  }

  const now = new Date().toISOString();
  if (!product) {
    product = {
      id: crypto.randomUUID(),
      userId: user.id,
      clicks: 0,
      createdAt: now,
    };
    db.products.push(product);
  }

  product.title = title;
  product.category = category;
  product.priceLabel = priceLabel;
  product.description = description;
  product.affiliateUrl = affiliateUrl;
  product.imageUrl = imageUrl;
  product.status = status;
  product.featured = user.role === 'owner' ? Boolean(body.featured) : Boolean(product.featured);
  product.updatedAt = now;

  saveDb(db);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleDeleteProduct(req, res, productId) {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) {
    return;
  }

  const product = db.products.find((entry) => entry.id === productId);
  if (!product) {
    sendError(res, 404, 'Product not found.');
    return;
  }

  if (user.role !== 'owner' && product.userId !== user.id) {
    sendError(res, 403, 'You can only delete your own products.');
    return;
  }

  deleteImage(product.imageUrl);
  db.products = db.products.filter((entry) => entry.id !== productId);
  saveDb(db);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleFeatureProduct(req, res, productId) {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user || !requireOwnerRole(res, user)) {
    return;
  }

  const product = db.products.find((entry) => entry.id === productId);
  if (!product) {
    sendError(res, 404, 'Product not found.');
    return;
  }

  product.featured = !product.featured;
  product.updatedAt = new Date().toISOString();
  saveDb(db);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleSubscribe(req, res) {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) {
    return;
  }

  if (user.role === 'owner') {
    sendError(res, 400, 'The owner account does not need a paid plan.');
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendError(res, 400, 'Invalid JSON payload.');
    return;
  }

  const cycles = safeNumber(body.cycles || 1, 1, 1, 12);
  const startMs = getRenewalStart(user.subscriptionEndsAt);
  user.subscriptionEndsAt = new Date(startMs + cycles * MONTH_MS).toISOString();
  user.lastPaymentAmount = Number(db.site.planPriceUsd) * cycles;
  user.lastPaymentReference = `demo_${crypto.randomUUID().slice(0, 8)}`;
  user.updatedAt = new Date().toISOString();
  saveDb(db);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleUpdateSite(req, res) {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user || !requireOwnerRole(res, user)) {
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendError(res, 400, 'Invalid JSON payload.');
    return;
  }

  db.site.name = cleanText(body.name, 80) || DEFAULT_SITE.name;
  db.site.tagline = cleanText(body.tagline, 120) || DEFAULT_SITE.tagline;
  db.site.subheading = cleanMultiline(body.subheading, 260) || DEFAULT_SITE.subheading;
  db.site.accentLabel = cleanText(body.accentLabel, 120) || DEFAULT_SITE.accentLabel;
  db.site.planPriceUsd = safeNumber(body.planPriceUsd, DEFAULT_SITE.planPriceUsd, 0.01, 999);
  db.site.freeTrialDays = safeNumber(body.freeTrialDays, DEFAULT_SITE.freeTrialDays, 1, 365);
  saveDb(db);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleToggleUser(req, res, userId) {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user || !requireOwnerRole(res, user)) {
    return;
  }

  const target = db.users.find((entry) => entry.id === userId);
  if (!target) {
    sendError(res, 404, 'User not found.');
    return;
  }

  if (target.role === 'owner') {
    sendError(res, 400, 'The owner account cannot be disabled.');
    return;
  }

  target.isActive = target.isActive === false;
  target.updatedAt = new Date().toISOString();
  saveDb(db);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleGrantCycle(req, res, userId) {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user || !requireOwnerRole(res, user)) {
    return;
  }

  const target = db.users.find((entry) => entry.id === userId);
  if (!target) {
    sendError(res, 404, 'User not found.');
    return;
  }

  if (target.role === 'owner') {
    sendError(res, 400, 'The owner account does not need a paid cycle.');
    return;
  }

  const startMs = getRenewalStart(target.subscriptionEndsAt);
  target.subscriptionEndsAt = new Date(startMs + MONTH_MS).toISOString();
  target.updatedAt = new Date().toISOString();
  saveDb(db);
  sendJson(res, 200, buildBootstrapPayload(db, user));
}

async function handleRedirect(res, productId) {
  const db = loadDb();
  const product = db.products.find((entry) => entry.id === productId);
  if (!product || !canProductBeVisible(product, db)) {
    sendText(res, 404, 'This affiliate product is not available right now.');
    return;
  }

  product.clicks = Number(product.clicks || 0) + 1;
  product.updatedAt = new Date().toISOString();
  saveDb(db);
  res.writeHead(302, {
    Location: product.affiliateUrl,
  });
  res.end();
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, 'Not found.');
    return;
  }
  res.writeHead(200, { 'Content-Type': getContentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

function safeJoin(baseDir, pathname) {
  const cleaned = pathname.replace(/^\/+/, '');
  const fullPath = path.resolve(path.join(baseDir, cleaned));
  if (!fullPath.startsWith(path.resolve(baseDir))) {
    return null;
  }
  return fullPath;
}

function createRequestHandler() {
  return async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    try {
      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        await handleBootstrap(req, res);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/setup-owner') {
        await handleSetupOwner(req, res);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/signup') {
        await handleSignup(req, res);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/login') {
        await handleLogin(req, res);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/logout') {
        await handleLogout(req, res);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/products/save') {
        await handleSaveProduct(req, res);
        return;
      }

      const productDeleteMatch = pathname.match(/^\/api\/products\/([^/]+)\/delete$/);
      if (req.method === 'POST' && productDeleteMatch) {
        await handleDeleteProduct(req, res, productDeleteMatch[1]);
        return;
      }

      const productFeatureMatch = pathname.match(/^\/api\/products\/([^/]+)\/feature$/);
      if (req.method === 'POST' && productFeatureMatch) {
        await handleFeatureProduct(req, res, productFeatureMatch[1]);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/billing/subscribe') {
        await handleSubscribe(req, res);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/admin/site') {
        await handleUpdateSite(req, res);
        return;
      }

      const userToggleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/toggle$/);
      if (req.method === 'POST' && userToggleMatch) {
        await handleToggleUser(req, res, userToggleMatch[1]);
        return;
      }

      const userGrantMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/grant-cycle$/);
      if (req.method === 'POST' && userGrantMatch) {
        await handleGrantCycle(req, res, userGrantMatch[1]);
        return;
      }

      const redirectMatch = pathname.match(/^\/go\/([^/]+)$/);
      if (req.method === 'GET' && redirectMatch) {
        await handleRedirect(res, redirectMatch[1]);
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
        const filePath = safeJoin(ROOT_DIR, pathname);
        if (!filePath) {
          sendText(res, 400, 'Bad request.');
          return;
        }
        serveFile(res, filePath);
        return;
      }

      if (req.method === 'GET') {
        const staticPath = pathname === '/' ? '/index.html' : pathname;
        const filePath = safeJoin(PUBLIC_DIR, staticPath);
        if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          serveFile(res, filePath);
          return;
        }

        serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
        return;
      }

      sendText(res, 405, 'Method not allowed.');
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendError(res, 400, 'Malformed request payload.');
        return;
      }

      console.error(error);
      sendError(res, 500, 'Something went wrong on the server.');
    }
  };
}

function createServer() {
  ensureStorage();
  return http.createServer(createRequestHandler());
}

function startServer(port = PORT) {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

if (require.main === module) {
  startServer().then((server) => {
    const address = server.address();
    const host = typeof address === 'object' && address ? address.address : 'localhost';
    const port = typeof address === 'object' && address ? address.port : PORT;
    console.log(`LinkCanvas is running at http://${host === '::' ? 'localhost' : host}:${port}`);
  });
}

module.exports = {
  createServer,
  startServer,
  paths: {
    ROOT_DIR,
    PUBLIC_DIR,
    DATA_DIR,
    UPLOAD_DIR,
    DB_FILE,
  },
};
