const state = {
  data: null,
  editor: null,
  imageData: '',
  imageName: '',
  notice: null,
};

let root;

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

document.addEventListener('DOMContentLoaded', () => {
  root = document.getElementById('app');
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  refresh();
});

async function api(url, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || 'Something went wrong.');
  }

  return payload;
}

async function refresh() {
  try {
    state.data = await api('/api/bootstrap');
    if (state.editor && state.data?.dashboard) {
      const nextEditor = state.data.dashboard.products.find((product) => product.id === state.editor.id);
      state.editor = nextEditor || null;
    }
    render();
  } catch (error) {
    root.innerHTML = `
      <div class="page-shell">
        <section class="portal-shell portal-wide">
          <div class="section-heading">
            <span class="eyebrow">Server issue</span>
            <h2>We could not load the website.</h2>
            <p>${escapeHtml(error.message)}</p>
          </div>
        </section>
      </div>
    `;
  }
}

function setNotice(type, message) {
  state.notice = { type, message };
}

function money(value) {
  return moneyFormatter.format(Number(value || 0));
}

function formatDate(value) {
  if (!value) {
    return 'Not set';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function planCopy(plan) {
  if (!plan) {
    return '';
  }
  if (plan.type === 'owner') {
    return 'You can publish products, manage vendors, and update the whole site.';
  }
  if (plan.type === 'trial') {
    return `${plan.reason} Then the plan continues at ${money(plan.priceUsd)} per month.`;
  }
  if (plan.type === 'paid') {
    return `${plan.reason} Renewal price: ${money(plan.priceUsd)} per month.`;
  }
  if (plan.type === 'suspended') {
    return 'Your account is paused by the owner. Contact the site owner to restore access.';
  }
  return `Upgrade to keep publishing at ${money(plan.priceUsd)} per month.`;
}

function getPreviewProduct(site, publicProducts) {
  if (publicProducts.length) {
    return publicProducts[0];
  }

  return {
    id: 'preview',
    title: 'Your hero product card',
    description: 'Upload an image, add your affiliate link, and send visitors straight to checkout.',
    category: 'Featured',
    priceLabel: 'Top pick',
    imageUrl:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 520">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#f3b485"/>
              <stop offset="100%" stop-color="#4b8f8c"/>
            </linearGradient>
          </defs>
          <rect width="700" height="520" fill="#17241f"/>
          <circle cx="540" cy="112" r="88" fill="#f3b485" opacity="0.28"/>
          <circle cx="152" cy="384" r="110" fill="#4b8f8c" opacity="0.30"/>
          <rect x="70" y="72" width="560" height="376" rx="36" fill="url(#g1)" opacity="0.95"/>
          <rect x="112" y="114" width="476" height="208" rx="26" fill="#fff7ec" opacity="0.88"/>
          <rect x="112" y="350" width="232" height="44" rx="22" fill="#17241f" opacity="0.88"/>
          <rect x="364" y="350" width="120" height="44" rx="22" fill="#ef7e56" opacity="0.88"/>
        </svg>
      `),
    featured: true,
    clicks: 0,
    redirectUrl: '#portal',
    ownerName: site.name,
  };
}

function renderHero(site, publicProducts, currentUser) {
  const preview = getPreviewProduct(site, publicProducts);
  const stats = [
    {
      label: 'Live products',
      value: String(publicProducts.length).padStart(2, '0'),
    },
    {
      label: 'Plan after trial',
      value: money(site.planPriceUsd),
    },
    {
      label: 'Free access',
      value: `${site.freeTrialDays} days`,
    },
  ];

  const previewStack = publicProducts.slice(0, 3).map((product, index) => {
    return `
      <article class="mini-card" style="animation-delay:${index * 120}ms">
        <span>${escapeHtml(product.category || 'Affiliate')}</span>
        <strong>${escapeHtml(product.title)}</strong>
      </article>
    `;
  });

  return `
    <section class="hero-section">
      <div class="hero-copy">
        <span class="eyebrow">${escapeHtml(site.accentLabel)}</span>
        <h1>${escapeHtml(site.name)}</h1>
        <p class="hero-tagline">${escapeHtml(site.tagline)}</p>
        <p class="hero-subheading">${escapeHtml(site.subheading)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#products">See storefront</a>
          <a class="btn btn-secondary" href="#portal">${currentUser ? 'Open dashboard' : 'Create your portal'}</a>
        </div>
        <div class="stat-row">
          ${stats
            .map(
              (item) => `
                <div class="stat-chip">
                  <strong>${escapeHtml(item.value)}</strong>
                  <span>${escapeHtml(item.label)}</span>
                </div>
              `,
            )
            .join('')}
        </div>
      </div>
      <div class="hero-visual">
        <div class="spotlight-card">
          <div class="spotlight-media">
            <img src="${escapeHtml(preview.imageUrl)}" alt="${escapeHtml(preview.title)}" />
          </div>
          <div class="spotlight-body">
            <div class="product-meta-row">
              <span>${escapeHtml(preview.category || 'Featured')}</span>
              <strong>${escapeHtml(preview.priceLabel || 'Commission ready')}</strong>
            </div>
            <h3>${escapeHtml(preview.title)}</h3>
            <p>${escapeHtml(preview.description)}</p>
            <div class="spotlight-footer">
              <span>By ${escapeHtml(preview.ownerName || site.name)}</span>
              <a href="${escapeHtml(preview.redirectUrl)}" class="text-link">${preview.id === 'preview' ? 'Open portal' : 'Shop now'}</a>
            </div>
          </div>
        </div>
        <div class="mini-stack">
          ${previewStack.length ? previewStack.join('') : '<article class="mini-card"><span>Owner tools</span><strong>Vendor billing and product uploads included</strong></article>'}
        </div>
      </div>
    </section>
  `;
}

function renderShowcase(publicProducts) {
  return `
    <section class="section-block" id="products">
      <div class="section-heading">
        <span class="eyebrow">Storefront</span>
        <h2>Affiliate products designed to get clicked</h2>
        <p>Your visitors only need one tap to reach the affiliate checkout page, while you control every listing from your own dashboard.</p>
      </div>
      ${
        publicProducts.length
          ? `<div class="product-grid">
              ${publicProducts
                .map((product, index) => {
                  return `
                    <article class="product-card ${product.featured ? 'product-card-featured' : ''}" style="animation-delay:${index * 80}ms">
                      <div class="product-image-wrap">
                        <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" />
                        ${product.featured ? '<span class="badge badge-featured">Featured</span>' : ''}
                      </div>
                      <div class="product-card-body">
                        <div class="product-meta-row">
                          <span>${escapeHtml(product.category || 'Affiliate')}</span>
                          <strong>${escapeHtml(product.priceLabel || 'Shop now')}</strong>
                        </div>
                        <h3>${escapeHtml(product.title)}</h3>
                        <p>${escapeHtml(product.description)}</p>
                        <div class="card-footer-row">
                          <small>Posted by ${escapeHtml(product.ownerName)}</small>
                          <a class="btn btn-primary btn-small" href="${escapeHtml(product.redirectUrl)}">Visit product</a>
                        </div>
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>`
          : `<div class="empty-state">
              <h3>No products are live yet</h3>
              <p>Create the owner account below, then upload your first image and affiliate link to bring the storefront to life.</p>
            </div>`
      }
    </section>
  `;
}

function renderJourney(site) {
  const steps = [
    {
      title: 'Upload a product',
      copy: 'Add a title, image, category, price label, and the affiliate URL you want clicks to hit.',
    },
    {
      title: 'Let vendors join',
      copy: `Other people can sign up, enjoy ${site.freeTrialDays} free days, then continue at ${money(site.planPriceUsd)} per month.`,
    },
    {
      title: 'Manage everything',
      copy: 'As the owner, you can feature products, adjust pricing, pause users, and extend subscriptions.',
    },
  ];

  return `
    <section class="section-block">
      <div class="section-heading">
        <span class="eyebrow">How it works</span>
        <h2>Built for a simple affiliate business model</h2>
      </div>
      <div class="journey-grid">
        ${steps
          .map(
            (step, index) => `
              <article class="journey-card" style="animation-delay:${index * 100}ms">
                <span class="journey-count">0${index + 1}</span>
                <h3>${escapeHtml(step.title)}</h3>
                <p>${escapeHtml(step.copy)}</p>
              </article>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderPricing(site) {
  return `
    <section class="section-block pricing-block">
      <div class="section-heading">
        <span class="eyebrow">Plans</span>
        <h2>Free for 3 months, then ultra-low monthly billing</h2>
        <p>Visitors browse for free. Vendors get a generous trial, then move to the paid plan when they want to keep posting products.</p>
      </div>
      <div class="pricing-grid">
        <article class="pricing-card pricing-card-main">
          <span class="badge badge-soft">Vendor plan</span>
          <h3>${site.freeTrialDays} days free</h3>
          <p class="pricing-price">${money(site.planPriceUsd)}<small>/month after trial</small></p>
          <ul class="feature-list">
            <li>Upload product images and affiliate links</li>
            <li>Publish or draft your own listings</li>
            <li>Stay live while your plan is active</li>
            <li>Owner can extend or pause accounts</li>
          </ul>
        </article>
        <article class="pricing-card">
          <span class="badge badge-soft">Owner access</span>
          <h3>Full control</h3>
          <p class="pricing-copy">Create the website owner account once, then manage the entire marketplace from the admin dashboard.</p>
          <ul class="feature-list">
            <li>Feature products on the storefront</li>
            <li>Edit headline copy and pricing</li>
            <li>Manage vendors and subscriptions</li>
            <li>Track outbound affiliate clicks</li>
          </ul>
        </article>
      </div>
    </section>
  `;
}

function renderOwnerSetup() {
  return `
    <section class="portal-shell portal-wide">
      <div class="section-heading">
        <span class="eyebrow">Owner setup</span>
        <h2>Create the main website owner account</h2>
        <p>This is the one account with full control over the whole website. Create it once, then vendors can sign up under your platform.</p>
      </div>
      <form class="form-grid" id="setupOwnerForm">
        <label>
          <span>Your name</span>
          <input type="text" name="name" placeholder="Owner name" required />
        </label>
        <label>
          <span>Email</span>
          <input type="email" name="email" placeholder="owner@example.com" required />
        </label>
        <label class="form-span-2">
          <span>Password</span>
          <input type="password" name="password" placeholder="At least 8 characters" minlength="8" required />
        </label>
        <button class="btn btn-primary form-submit" type="submit">Create owner account</button>
      </form>
    </section>
  `;
}

function renderAuthPortal(site) {
  return `
    <section class="portal-shell">
      <div class="section-heading">
        <span class="eyebrow">Vendor portal</span>
        <h2>Join the marketplace and start posting affiliate products</h2>
        <p>Each vendor gets ${site.freeTrialDays} days free, then the plan continues at ${money(site.planPriceUsd)} per month.</p>
      </div>
      <div class="auth-grid">
        <form class="form-card" id="signupForm">
          <h3>Create vendor account</h3>
          <label>
            <span>Full name</span>
            <input type="text" name="name" placeholder="Your name" required />
          </label>
          <label>
            <span>Email</span>
            <input type="email" name="email" placeholder="you@example.com" required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" name="password" placeholder="At least 8 characters" minlength="8" required />
          </label>
          <button class="btn btn-primary form-submit" type="submit">Start free trial</button>
        </form>
        <form class="form-card" id="loginForm">
          <h3>Log in</h3>
          <label>
            <span>Email</span>
            <input type="email" name="email" placeholder="you@example.com" required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" name="password" placeholder="Your password" required />
          </label>
          <div class="support-copy">
            <p>Owners and vendors both log in here.</p>
          </div>
          <button class="btn btn-secondary form-submit" type="submit">Open dashboard</button>
        </form>
      </div>
    </section>
  `;
}

function renderPlanBanner(user) {
  return `
    <article class="plan-banner plan-${escapeHtml(user.plan.type)}">
      <div>
        <span class="eyebrow">Account status</span>
        <h3>${escapeHtml(user.plan.label)}</h3>
        <p>${escapeHtml(planCopy(user.plan))}</p>
      </div>
      <div class="plan-banner-meta">
        <strong>${user.plan.type === 'owner' ? 'All access' : money(user.plan.priceUsd)}</strong>
        <span>${user.plan.type === 'trial' ? `Ends ${formatDate(user.plan.trialEndsAt)}` : user.plan.subscriptionEndsAt ? `Active until ${formatDate(user.plan.subscriptionEndsAt)}` : 'Billing needed after trial'}</span>
      </div>
    </article>
  `;
}

function renderProductForm(currentUser) {
  const editing = state.editor;
  const previewImage = state.imageData || editing?.imageUrl || '';
  const locked = currentUser.role !== 'owner' && !currentUser.plan.canPublish;
  const disabled = locked ? 'disabled' : '';
  const featuredToggle =
    currentUser.role === 'owner'
      ? `
        <label class="switch-row">
          <input type="checkbox" name="featured" ${editing?.featured ? 'checked' : ''} />
          <span>Feature this product on the storefront</span>
        </label>
      `
      : '';

  return `
    <article class="dashboard-card" id="product-form-card">
      <div class="card-heading">
        <div>
          <span class="eyebrow">Product editor</span>
          <h3>${editing ? 'Edit affiliate product' : 'Add a new affiliate product'}</h3>
        </div>
        ${
          editing
            ? '<button class="btn btn-ghost btn-small" type="button" data-action="clear-editor">Clear editor</button>'
            : ''
        }
      </div>
      ${locked ? `<p class="locked-copy">Billing is required before this vendor account can publish or edit products.</p>` : ''}
      <form class="form-grid" id="productForm">
        <input type="hidden" name="id" value="${escapeHtml(editing?.id || '')}" />
        <label>
          <span>Product title</span>
          <input type="text" name="title" placeholder="Noise-cancelling headphones" value="${escapeHtml(editing?.title || '')}" required ${disabled} />
        </label>
        <label>
          <span>Category</span>
          <input type="text" name="category" placeholder="Tech, Home, Beauty..." value="${escapeHtml(editing?.category || '')}" ${disabled} />
        </label>
        <label>
          <span>Price label</span>
          <input type="text" name="priceLabel" placeholder="$59 or Best seller" value="${escapeHtml(editing?.priceLabel || '')}" ${disabled} />
        </label>
        <label>
          <span>Status</span>
          <select name="status" ${disabled}>
            <option value="published" ${editing?.status !== 'draft' ? 'selected' : ''}>Published</option>
            <option value="draft" ${editing?.status === 'draft' ? 'selected' : ''}>Draft</option>
          </select>
        </label>
        <label class="form-span-2">
          <span>Affiliate link</span>
          <input type="url" name="affiliateUrl" placeholder="https://your-affiliate-link.com" value="${escapeHtml(editing?.affiliateUrl || '')}" required ${disabled} />
        </label>
        <label class="form-span-2">
          <span>Description</span>
          <textarea name="description" rows="5" placeholder="Describe why this product is worth clicking..." required ${disabled}>${escapeHtml(editing?.description || '')}</textarea>
        </label>
        <label class="form-span-2">
          <span>Product image</span>
          <input type="file" id="productImage" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif" ${disabled} />
          <small class="field-hint" id="productImageHint">${state.imageName ? `Selected image: ${escapeHtml(state.imageName)}` : 'Choose an image to upload. Keep it under 5MB.'}</small>
        </label>
        <div class="image-preview form-span-2 ${previewImage ? '' : 'image-preview-empty'}">
          <img id="productPreviewImage" src="${escapeHtml(previewImage)}" alt="Product preview" />
        </div>
        ${featuredToggle}
        <button class="btn btn-primary form-submit" type="submit" ${disabled}>${editing ? 'Update product' : 'Publish product'}</button>
      </form>
    </article>
  `;
}

function renderBillingCard(currentUser) {
  if (currentUser.role === 'owner') {
    return '';
  }

  return `
    <article class="dashboard-card">
      <div class="card-heading">
        <div>
          <span class="eyebrow">Billing</span>
          <h3>Keep your listings live</h3>
        </div>
        <span class="price-pill">${money(currentUser.plan.priceUsd)}/month</span>
      </div>
      <p class="card-copy">This demo checkout activates the subscription logic now. Replace the billing endpoint with Stripe or PayPal before launching real payments.</p>
      <form id="subscribeForm" class="billing-row">
        <label>
          <span>Billing cycles</span>
          <select name="cycles">
            <option value="1">1 month</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
          </select>
        </label>
        <button class="btn btn-secondary form-submit" type="submit">Activate plan</button>
      </form>
    </article>
  `;
}

function renderDashboardProducts(products, isOwner) {
  return `
    <article class="dashboard-card">
      <div class="card-heading">
        <div>
          <span class="eyebrow">Products</span>
          <h3>${isOwner ? 'All uploaded products' : 'Your uploaded products'}</h3>
        </div>
      </div>
      ${
        products.length
          ? `<div class="manage-list">
              ${products
                .map(
                  (product) => `
                    <div class="manage-item">
                      <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" />
                      <div class="manage-copy">
                        <strong>${escapeHtml(product.title)}</strong>
                        <p>${escapeHtml(product.description)}</p>
                        <div class="manage-meta">
                          <span>${escapeHtml(product.category || 'Affiliate')}</span>
                          <span>${escapeHtml(product.status)}</span>
                          <span>${product.isLive ? 'Live' : 'Hidden'}</span>
                          <span>${product.clicks} click${product.clicks === 1 ? '' : 's'}</span>
                          ${isOwner ? `<span>${escapeHtml(product.ownerName)}</span>` : ''}
                        </div>
                      </div>
                      <div class="manage-actions">
                        <button class="btn btn-ghost btn-small" type="button" data-action="edit-product" data-product-id="${escapeHtml(product.id)}">Edit</button>
                        ${
                          isOwner
                            ? `<button class="btn btn-ghost btn-small" type="button" data-action="toggle-feature" data-product-id="${escapeHtml(product.id)}">${product.featured ? 'Unfeature' : 'Feature'}</button>`
                            : ''
                        }
                        <button class="btn btn-danger btn-small" type="button" data-action="delete-product" data-product-id="${escapeHtml(product.id)}">Delete</button>
                      </div>
                    </div>
                  `,
                )
                .join('')}
            </div>`
          : `<div class="empty-state compact">
              <h3>No products yet</h3>
              <p>Use the product editor above to publish your first affiliate listing.</p>
            </div>`
      }
    </article>
  `;
}

function renderOwnerStats(admin) {
  const items = [
    ['Total users', admin.totals.totalUsers],
    ['Active vendors', admin.totals.activeVendors],
    ['Live products', admin.totals.liveProducts],
    ['Total clicks', admin.totals.totalClicks],
  ];

  return `
    <div class="admin-metrics">
      ${items
        .map(
          ([label, value]) => `
            <article class="metric-card">
              <strong>${escapeHtml(String(value))}</strong>
              <span>${escapeHtml(label)}</span>
            </article>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderSiteForm(site) {
  return `
    <article class="dashboard-card">
      <div class="card-heading">
        <div>
          <span class="eyebrow">Brand settings</span>
          <h3>Customize your website copy and pricing</h3>
        </div>
      </div>
      <form class="form-grid" id="siteSettingsForm">
        <label>
          <span>Website name</span>
          <input type="text" name="name" value="${escapeHtml(site.name)}" required />
        </label>
        <label>
          <span>Hero tagline</span>
          <input type="text" name="tagline" value="${escapeHtml(site.tagline)}" required />
        </label>
        <label>
          <span>Monthly plan price</span>
          <input type="number" step="0.01" min="0.01" name="planPriceUsd" value="${escapeHtml(site.planPriceUsd)}" required />
        </label>
        <label>
          <span>Free trial days</span>
          <input type="number" min="1" max="365" name="freeTrialDays" value="${escapeHtml(site.freeTrialDays)}" required />
        </label>
        <label class="form-span-2">
          <span>Accent label</span>
          <input type="text" name="accentLabel" value="${escapeHtml(site.accentLabel)}" required />
        </label>
        <label class="form-span-2">
          <span>Hero subheading</span>
          <textarea name="subheading" rows="4" required>${escapeHtml(site.subheading)}</textarea>
        </label>
        <button class="btn btn-secondary form-submit" type="submit">Save website settings</button>
      </form>
    </article>
  `;
}

function renderUserManagement(users) {
  return `
    <article class="dashboard-card">
      <div class="card-heading">
        <div>
          <span class="eyebrow">Vendor management</span>
          <h3>Control access for everyone on your platform</h3>
        </div>
      </div>
      <div class="manage-list">
        ${users
          .map(
            (user) => `
              <div class="manage-item user-item">
                <div class="avatar-badge">${escapeHtml(user.name.charAt(0).toUpperCase())}</div>
                <div class="manage-copy">
                  <strong>${escapeHtml(user.name)} ${user.role === 'owner' ? '<span class="badge badge-soft">Owner</span>' : ''}</strong>
                  <p>${escapeHtml(user.email)}</p>
                  <div class="manage-meta">
                    <span>${escapeHtml(user.plan.label)}</span>
                    <span>${user.isActive ? 'Active' : 'Paused'}</span>
                    <span>Joined ${formatDate(user.createdAt)}</span>
                  </div>
                </div>
                ${
                  user.role === 'vendor'
                    ? `<div class="manage-actions">
                        <button class="btn btn-ghost btn-small" type="button" data-action="grant-cycle" data-user-id="${escapeHtml(user.id)}">Add 30 days</button>
                        <button class="btn btn-danger btn-small" type="button" data-action="toggle-user" data-user-id="${escapeHtml(user.id)}">${user.isActive ? 'Pause' : 'Restore'}</button>
                      </div>`
                    : ''
                }
              </div>
            `,
          )
          .join('')}
      </div>
    </article>
  `;
}

function renderDashboard(currentUser, dashboard, admin, site) {
  const isOwner = currentUser.role === 'owner';
  return `
    <section class="portal-shell portal-wide">
      <div class="section-heading">
        <span class="eyebrow">${isOwner ? 'Owner dashboard' : 'Vendor dashboard'}</span>
        <h2>Welcome back, ${escapeHtml(currentUser.name)}</h2>
        <p>${escapeHtml(planCopy(currentUser.plan))}</p>
      </div>
      ${renderPlanBanner(currentUser)}
      ${isOwner && admin ? renderOwnerStats(admin) : ''}
      <div class="dashboard-grid">
        <div class="dashboard-column">
          ${renderProductForm(currentUser)}
          ${renderDashboardProducts(dashboard.products, isOwner)}
        </div>
        <div class="dashboard-column">
          ${renderBillingCard(currentUser)}
          ${isOwner ? renderSiteForm(site) : ''}
        </div>
      </div>
      ${isOwner && admin ? renderUserManagement(admin.users) : ''}
    </section>
  `;
}

function renderPortal(data) {
  if (data.setupRequired) {
    return renderOwnerSetup();
  }

  if (!data.currentUser) {
    return renderAuthPortal(data.site);
  }

  return renderDashboard(data.currentUser, data.dashboard, data.admin, data.site);
}

function renderNotice() {
  if (!state.notice) {
    return '';
  }
  return `
    <div class="notice notice-${escapeHtml(state.notice.type)}">
      <span>${escapeHtml(state.notice.message)}</span>
      <button type="button" class="notice-close" data-action="dismiss-notice">Dismiss</button>
    </div>
  `;
}

function render() {
  if (!state.data) {
    root.innerHTML = '<div class="page-shell"><section class="portal-shell"><p>Loading…</p></section></div>';
    return;
  }

  const { site, publicProducts, currentUser } = state.data;
  root.innerHTML = `
    <div class="page-shell">
      <div class="bg-orb orb-one"></div>
      <div class="bg-orb orb-two"></div>
      <div class="bg-grid"></div>
      <header class="topbar">
        <a class="brandmark" href="/">
          <span class="brandmark-icon">LC</span>
          <span class="brandmark-copy">
            <strong>${escapeHtml(site.name)}</strong>
            <small>Affiliate storefront platform</small>
          </span>
        </a>
        <nav class="topbar-actions">
          <a class="nav-link" href="#products">Storefront</a>
          <a class="nav-link" href="#portal">${currentUser ? 'Dashboard' : 'Portal'}</a>
          ${
            currentUser
              ? `<button class="btn btn-ghost btn-small" type="button" data-action="logout">Log out</button>`
              : ''
          }
        </nav>
      </header>
      ${renderNotice()}
      <main>
        ${renderHero(site, publicProducts, currentUser)}
        ${renderShowcase(publicProducts)}
        ${renderJourney(site)}
        ${renderPricing(site)}
        <div id="portal">
          ${renderPortal(state.data)}
        </div>
      </main>
      <footer class="site-footer">
        <strong>${escapeHtml(site.name)}</strong>
        <p>Built for affiliate product discovery, vendor monetization, and easy website ownership.</p>
      </footer>
    </div>
  `;
}

function getProductById(productId) {
  const products = state.data?.dashboard?.products || [];
  return products.find((product) => product.id === productId) || null;
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  event.preventDefault();

  try {
    if (form.id === 'setupOwnerForm') {
      const data = formToObject(new FormData(form));
      state.data = await api('/api/setup-owner', { method: 'POST', body: data });
      setNotice('success', 'Owner account created. Your website is ready to manage.');
      render();
      return;
    }

    if (form.id === 'signupForm') {
      const data = formToObject(new FormData(form));
      state.data = await api('/api/signup', { method: 'POST', body: data });
      setNotice('success', 'Vendor account created. Your free trial has started.');
      render();
      return;
    }

    if (form.id === 'loginForm') {
      const data = formToObject(new FormData(form));
      state.data = await api('/api/login', { method: 'POST', body: data });
      setNotice('success', 'Welcome back. Your dashboard is ready.');
      render();
      return;
    }

    if (form.id === 'productForm') {
      const data = formToObject(new FormData(form));
      if (state.imageData) {
        data.imageData = state.imageData;
        data.imageName = state.imageName;
      }
      data.featured = form.querySelector('[name="featured"]')?.checked || false;
      state.data = await api('/api/products/save', { method: 'POST', body: data });
      state.editor = null;
      state.imageData = '';
      state.imageName = '';
      setNotice('success', 'Product saved successfully.');
      render();
      return;
    }

    if (form.id === 'subscribeForm') {
      const data = formToObject(new FormData(form));
      state.data = await api('/api/billing/subscribe', { method: 'POST', body: data });
      setNotice('success', 'Subscription activated. Your listings can stay live.');
      render();
      return;
    }

    if (form.id === 'siteSettingsForm') {
      const data = formToObject(new FormData(form));
      state.data = await api('/api/admin/site', { method: 'POST', body: data });
      setNotice('success', 'Website settings updated.');
      render();
    }
  } catch (error) {
    setNotice('error', error.message);
    render();
  }
}

async function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }

  const action = button.dataset.action;

  try {
    if (action === 'dismiss-notice') {
      state.notice = null;
      render();
      return;
    }

    if (action === 'logout') {
      await api('/api/logout', { method: 'POST', body: {} });
      state.editor = null;
      state.imageData = '';
      state.imageName = '';
      await refresh();
      setNotice('success', 'You have been logged out.');
      render();
      return;
    }

    if (action === 'clear-editor') {
      state.editor = null;
      state.imageData = '';
      state.imageName = '';
      render();
      return;
    }

    if (action === 'edit-product') {
      const product = getProductById(button.dataset.productId);
      if (!product) {
        return;
      }
      state.editor = product;
      state.imageData = '';
      state.imageName = '';
      render();
      document.getElementById('portal')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (action === 'delete-product') {
      const productId = button.dataset.productId;
      if (!productId || !window.confirm('Delete this product?')) {
        return;
      }
      state.data = await api(`/api/products/${productId}/delete`, { method: 'POST', body: {} });
      if (state.editor?.id === productId) {
        state.editor = null;
      }
      state.imageData = '';
      state.imageName = '';
      setNotice('success', 'Product deleted.');
      render();
      return;
    }

    if (action === 'toggle-feature') {
      const productId = button.dataset.productId;
      state.data = await api(`/api/products/${productId}/feature`, { method: 'POST', body: {} });
      setNotice('success', 'Product highlight updated.');
      render();
      return;
    }

    if (action === 'toggle-user') {
      const userId = button.dataset.userId;
      state.data = await api(`/api/admin/users/${userId}/toggle`, { method: 'POST', body: {} });
      setNotice('success', 'User status updated.');
      render();
      return;
    }

    if (action === 'grant-cycle') {
      const userId = button.dataset.userId;
      state.data = await api(`/api/admin/users/${userId}/grant-cycle`, { method: 'POST', body: {} });
      setNotice('success', 'Added 30 days to that vendor plan.');
      render();
    }
  } catch (error) {
    setNotice('error', error.message);
    render();
  }
}

function handleChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (input.id !== 'productImage') {
    return;
  }

  const file = input.files?.[0];
  if (!file) {
    state.imageData = '';
    state.imageName = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.imageData = String(reader.result || '');
    state.imageName = file.name;
    const previewImage = document.getElementById('productPreviewImage');
    const previewFrame = previewImage?.closest('.image-preview');
    const hint = document.getElementById('productImageHint');
    if (previewImage instanceof HTMLImageElement) {
      previewImage.src = state.imageData;
      previewFrame?.classList.remove('image-preview-empty');
    }
    if (hint) {
      hint.textContent = `Selected image: ${file.name}`;
    }
  };
  reader.readAsDataURL(file);
}

function formToObject(formData) {
  return Array.from(formData.entries()).reduce((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});
}
