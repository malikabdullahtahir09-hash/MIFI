const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linkcanvas-'));
process.env.APP_DATA_DIR = path.join(tempRoot, 'data');
process.env.APP_UPLOAD_DIR = path.join(tempRoot, 'uploads');
process.env.APP_DB_FILE = path.join(process.env.APP_DATA_DIR, 'store.json');

const { startServer } = require('./server');

const tinyImage =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wf8rjgAAAAASUVORK5CYII=';

function extractCookies(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);

  return values.map((value) => value.split(';')[0]).join('; ');
}

async function main() {
  const server = await startServer(0);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let cookie = '';

  async function request(url, options = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
      method: options.method || 'GET',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      redirect: options.redirect || 'follow',
    });

    const nextCookies = extractCookies(response);
    if (nextCookies) {
      cookie = nextCookies;
    }

    const text = await response.text();
    let payload = {};
    if (text) {
      payload = JSON.parse(text);
    }

    return { response, payload };
  }

  try {
    let result = await request('/api/bootstrap');
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.setupRequired, true);

    result = await request('/api/setup-owner', {
      method: 'POST',
      body: {
        name: 'Owner',
        email: 'owner@example.com',
        password: 'ownerpass123',
      },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.payload.currentUser.role, 'owner');

    result = await request('/api/products/save', {
      method: 'POST',
      body: {
        title: 'Owner product',
        category: 'Tech',
        priceLabel: '$49',
        description: 'A featured owner listing.',
        affiliateUrl: 'https://example.com/owner',
        imageData: tinyImage,
        imageName: 'owner.png',
        status: 'published',
        featured: true,
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.dashboard.products.length, 1);

    result = await request('/api/logout', {
      method: 'POST',
      body: {},
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/signup', {
      method: 'POST',
      body: {
        name: 'Vendor',
        email: 'vendor@example.com',
        password: 'vendorpass123',
      },
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.payload.currentUser.role, 'vendor');
    assert.equal(result.payload.currentUser.plan.type, 'trial');

    result = await request('/api/products/save', {
      method: 'POST',
      body: {
        title: 'Vendor product',
        category: 'Home',
        priceLabel: '$19',
        description: 'A vendor listing.',
        affiliateUrl: 'https://example.com/vendor',
        imageData: tinyImage,
        imageName: 'vendor.png',
        status: 'published',
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.dashboard.products.length, 1);
    const vendorProduct = result.payload.dashboard.products[0];

    result = await request('/api/bootstrap');
    assert.equal(result.payload.publicProducts.length, 2);

    const db = JSON.parse(fs.readFileSync(process.env.APP_DB_FILE, 'utf8'));
    const vendor = db.users.find((user) => user.email === 'vendor@example.com');
    vendor.trialEndsAt = new Date(Date.now() - 86400000).toISOString();
    vendor.subscriptionEndsAt = null;
    fs.writeFileSync(process.env.APP_DB_FILE, JSON.stringify(db, null, 2));

    result = await request('/api/products/save', {
      method: 'POST',
      body: {
        title: 'Blocked product',
        category: 'Blocked',
        priceLabel: '$9',
        description: 'Should fail because billing expired.',
        affiliateUrl: 'https://example.com/blocked',
        imageData: tinyImage,
        imageName: 'blocked.png',
        status: 'published',
      },
    });
    assert.equal(result.response.status, 403);

    result = await request('/api/billing/subscribe', {
      method: 'POST',
      body: {
        cycles: 1,
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.currentUser.plan.type, 'paid');

    result = await request(`/go/${vendorProduct.id}`, {
      redirect: 'manual',
    });
    assert.equal(result.response.status, 302);
    assert.equal(result.response.headers.get('location'), 'https://example.com/vendor');

    console.log('Smoke test passed.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
