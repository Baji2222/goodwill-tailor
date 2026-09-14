const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 8000;
const ROOT = process.cwd();
const DATA_FILE = path.join(ROOT, 'data.json');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
let supabase = null;
const ADMIN_MOBILE = (process.env.ADMIN_MOBILE || '9494259885');
// In-memory OTP store for local development when Supabase SMS isn't configured
const otpStore = new Map();

if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2); // +91XXXXXXXXXX -> XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = {
      gw_staff: [
        { id: 'admin1', username: 'admin', password: 'goodwill123', name: 'Admin', isAdmin: true }
      ],
      gw_customers: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
  }
}

function readData() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {};
  } catch (e) {
    return {};
  }
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendStatic(res, requestPath) {
  const safePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\//, '');
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    sendJSON(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      sendJSON(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    }

    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw || '')).digest('hex');
}

async function migrateLegacyDataToSupabase() {
  if (!supabase) return;

  const legacy = readData();
  const staff = legacy.gw_staff || [];
  const customers = legacy.gw_customers || [];

  if (staff.length) {
    for (const s of staff) {
      const row = {
        id: s.id || 'staff-' + crypto.randomUUID(),
        username: s.username,
        password_hash: hashPassword(s.password),
        name: s.name || s.username,
        is_admin: Boolean(s.isAdmin),
        phone: normalizePhone(s.phone || s.username) || null,
        created_at: new Date().toISOString()
      };
      await supabase.from('staff').upsert(row, { onConflict: 'id' });
    }
  }

  if (customers.length) {
    for (const customer of customers) {
      const customerId = customer.id || 'customer-' + crypto.randomUUID();
      const cRow = {
        id: customerId,
        phone: customer.phone,
        name: customer.name,
        address: customer.address || '',
        notes: customer.notes || '',
        created_at: customer.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await supabase.from('customers').upsert(cRow, { onConflict: 'id' });

      const orders = customer.orders || [];
      for (const o of orders) {
        const oId = o.id || 'ORD-' + Date.now().toString().slice(-6);
        const photoRows = [];
        await supabase.from('orders').upsert({
          id: oId,
          customer_id: customerId,
          order_type: o.type || 'tailoring',
          status: o.status || 'pending',
          due_date: o.dueDate || '',
          total: Number(o.total || 0),
          paid: Number(o.advancePaid || o.paid || 0),
          measurements: o.measurements || '',
          notes: o.notes || '',
          quantity: Number(o.quantity || 0),
          garments: o.garments || {},
          taken_by: o.takenBy || 'Staff',
          created_at: o.createdAt || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

        const photos = o.photos || [];
        for (const p of photos) {
          const fileName = oId + '-' + crypto.randomUUID() + '.png';
          const buf = Buffer.from(p.split(',')[1], 'base64');
          const { error } = await supabase.storage.from('order-photos').upload(fileName, buf, {
            contentType: 'image/png',
            upsert: true
          });
          if (!error) {
            const url = await supabase.storage.from('order-photos').getPublicUrl(fileName);
            photoRows.push({
              id: 'photo-' + crypto.randomUUID(),
              order_id: oId,
              storage_path: fileName,
              public_url: url.data?.publicUrl || ''
            });
          }
        }

        if (photoRows.length) {
          await supabase.from('order_photos').upsert(photoRows, { onConflict: 'id' });
        }
      }
    }
  }
}

async function readStaffFromSupabase() {
  if (!supabase) return readData().gw_staff || [];
  const { data, error } = await supabase.from('staff').select('*');
  if (error) return readData().gw_staff || [];
  return data.map(r => ({
    id: r.id,
    username: r.username,
    name: r.name,
    isAdmin: Boolean(r.is_admin),
    password: ''
  }));
}

async function readCustomersFromSupabase() {
  if (!supabase) return readData().gw_customers || [];
  const { data: customers, error: cErr } = await supabase.from('customers').select('*');
  if (cErr) return readData().gw_customers || [];
  const { data: orders, error: oErr } = await supabase.from('orders').select('*');
  if (oErr) return customers.map(c => ({ id: c.id, phone: c.phone, name: c.name, address: c.address, notes: c.notes, orders: [] }));
  const { data: photos } = await supabase.from('order_photos').select('*');

  const customerMap = new Map();
  for (const c of customers) {
    customerMap.set(c.id, {
      id: c.id,
      phone: c.phone,
      name: c.name,
      address: c.address || '',
      notes: c.notes || '',
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      orders: []
    });
  }

  for (const o of orders) {
    const customer = customerMap.get(o.customer_id);
    if (!customer) continue;
    const orderPhotos = (photos || []).filter(p => p.order_id === o.id).map(p => p.public_url || p.storage_path);
    customer.orders.push({
      id: o.id,
      type: o.order_type,
      status: o.status,
      dueDate: o.due_date,
      total: o.total,
      paid: o.paid,
      advancePaid: o.paid,
      measurements: o.measurements,
      notes: o.notes,
      quantity: o.quantity,
      garments: o.garments || { shirt: 0, pant: 0 },
      takenBy: o.taken_by || 'Staff',
      createdAt: o.created_at,
      photos: orderPhotos
    });
  }

  return Array.from(customerMap.values());
}

async function saveStaffToSupabase(value) {
  if (!supabase) return writeData({ gw_staff: value, gw_customers: readData().gw_customers || [] });
  for (const s of value) {
    const row = {
      id: s.id || 'staff-' + crypto.randomUUID(),
      username: s.username,
      password_hash: hashPassword(s.password || ''),
      name: s.name || s.username,
      is_admin: Boolean(s.isAdmin)
    };
    await supabase.from('staff').upsert(row, { onConflict: 'id' });
  }
}

async function saveCustomersToSupabase(value) {
  if (!supabase) {
    const data = readData();
    data.gw_customers = value;
    writeData(data);
    return;
  }

  for (const customer of value) {
    const customerId = customer.id || 'customer-' + crypto.randomUUID();
    await supabase.from('customers').upsert({
      id: customerId,
      phone: customer.phone,
      name: customer.name,
      address: customer.address || '',
      notes: customer.notes || '',
      created_at: customer.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    for (const o of customer.orders || []) {
      const orderId = o.id || 'ORD-' + Date.now().toString().slice(-6);
      await supabase.from('orders').upsert({
        id: orderId,
        customer_id: customerId,
        order_type: o.type || 'tailoring',
        status: o.status || 'pending',
        due_date: o.dueDate || '',
        total: Number(o.total || 0),
        paid: Number(o.advancePaid || o.paid || 0),
        measurements: o.measurements || '',
        notes: o.notes || '',
        quantity: Number(o.quantity || 0),
        garments: o.garments || { shirt: 0, pant: 0 },
        taken_by: o.takenBy || 'Staff',
        created_at: o.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      const photos = o.photos || [];
      for (const p of photos) {
        if (!String(p).startsWith('data:')) continue;
        const match = String(p).match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,(.*)$/);
        if (!match) continue;
        const ext = match[1] === 'jpg' ? 'jpg' : match[1] === 'jpeg' ? 'jpeg' : match[1] === 'gif' ? 'gif' : 'png';
        const name = orderId + '-' + crypto.randomUUID() + '.' + ext;
        const buf = Buffer.from(match[2], 'base64');
        const { data: uploadData, error: uploadError } = await supabase.storage.from('order-photos').upload(name, buf, { contentType: 'image/' + ext, upsert: true });
        if (!uploadError && uploadData) {
          const url = await supabase.storage.from('order-photos').getPublicUrl(name);
          await supabase.from('order_photos').upsert({
            id: 'photo-' + crypto.randomUUID(),
            order_id: orderId,
            storage_path: name,
            public_url: url.data?.publicUrl || ''
          }, { onConflict: 'id' });
        }
      }
    }
  }
}

async function handleAuth(req, res, body) {
  // Username/password auth is deprecated for this application.
  // Authentication must be performed by phone OTP flows.
  return sendJSON(res, 410, { ok: false, error: 'Deprecated: use phone OTP endpoints (/api/send-otp and /api/verify-otp).' });
}

async function handleSendOtp(req, res, body) {
  try {
    const payload = JSON.parse(body || '{}');
    const rawPhone = String(payload.phone || '');
    const phone = normalizePhone(rawPhone);
    if (!phone) return sendJSON(res, 400, { ok: false, error: 'Invalid phone' });

    if (!supabase || !SUPABASE_PUBLISHABLE_KEY) {
        // Fallback: generate a dev OTP so local development can proceed without Supabase SMS
        const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
        otpStore.set(phone, code);
        console.log(`DEV OTP for ${phone}: ${code}`);

        return sendJSON(res, 200, { ok: true, info: 'OTP generated (dev). Check server logs.', devOtp: code });
    }

    // Attempt to send OTP using Supabase client (server-side). If supabase JS supports signInWithOtp, use it.
    try {
      const resp = await supabase.auth.signInWithOtp({ phone: '+91' + phone });
      return sendJSON(res, 200, { ok: true, info: 'OTP sent (if SMS configured).' });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: 'Failed to send OTP: ' + String(e.message || e) });
    }
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid payload' });
  }
}

async function handleVerifyOtp(req, res, body) {
  try {
    const payload = JSON.parse(body || '{}');
    const rawPhone = String(payload.phone || '');
    const token = String(payload.otp || payload.token || '');
    const phone = normalizePhone(rawPhone);
    if (!phone || !token) return sendJSON(res, 400, { ok: false, error: 'Invalid phone or otp' });

    if (!supabase) {
      // Verify against in-memory OTP store for local development
        const expected = otpStore.get(phone);
        if (expected && expected === token) {
          // consume this OTP so it cannot be reused
          otpStore.delete(phone);

            if (phone === normalizePhone(ADMIN_MOBILE)) {
              const u = { id: 'admin-' + phone, name: 'Admin', phone: phone, isAdmin: true };
              return sendJSON(res, 200, { ok: true, role: 'admin', user: u, staff: u });
            }

          const data = readData();
          const staff = (data.gw_staff || []).find(s => String(s.phone || s.username || '').replace(/\D/g, '') === phone) || null;

          if (staff) {
            const u = { id: staff.id, name: staff.name || staff.username || phone, phone: phone, isAdmin: Boolean(staff.isAdmin) };
            return sendJSON(res, 200, { ok: true, role: staff.isAdmin ? 'admin' : 'staff', user: u, staff: u });
          }

          return sendJSON(res, 403, { ok: false, error: 'Unknown staff number' });
        }

      return sendJSON(res, 401, { ok: false, error: 'Invalid OTP' });
    }

    // Try verify (some supabase versions offer verifyOtp API); fallback to signInWithOtp with token
    try {
      if (typeof supabase.auth.verifyOtp === 'function') {
        const v = await supabase.auth.verifyOtp({ phone: '+91' + phone, token, type: 'sms' });
        if (v.error) return sendJSON(res, 401, { ok: false, error: 'Invalid OTP' });
      } else {
        const v = await supabase.auth.signInWithOtp({ phone: '+91' + phone, token });
        if (v.error) return sendJSON(res, 401, { ok: false, error: 'Invalid OTP' });
      }
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: 'OTP verify failed: ' + String(e.message || e) });
    }

    // OTP verified; determine role
    const normalized = phone;

    if (normalized === normalizePhone(ADMIN_MOBILE)) {
      // Admin
      const u = { id: 'admin-' + normalized, name: 'Admin', phone: normalized, isAdmin: true };
      return sendJSON(res, 200, { ok: true, role: 'admin', user: u, staff: u });
    }

    // Check staff table for phone
    if (supabase) {
      const { data: rows, error } = await supabase.from('staff').select('*').eq('phone', normalized).limit(1);
      if (error) return sendJSON(res, 500, { ok: false, error: 'DB error' });
      if (!rows || !rows.length) return sendJSON(res, 403, { ok: false, error: 'Unknown staff number' });
      const s = rows[0];
      const u = { id: s.id, name: s.name, phone: s.phone, isAdmin: Boolean(s.is_admin) };
      return sendJSON(res, 200, { ok: true, role: s.is_admin ? 'admin' : 'staff', user: u, staff: u });
    }

    return sendJSON(res, 403, { ok: false, error: 'Unknown staff number' });
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: 'Invalid payload' });
  }
}

async function handleData(req, res, url) {
  const key = url.searchParams.get('key') || '';

  if (req.method === 'GET') {
    if (key === 'gw_staff') {
      const staff = await readStaffFromSupabase();
      sendJSON(res, 200, { key, value: staff });
      return;
    }

    if (key === 'gw_customers') {
      const customers = await readCustomersFromSupabase();
      sendJSON(res, 200, { key, value: customers });
      return;
    }

    if (key.startsWith('customer:')) {
      const phone = key.replace(/^customer:/, '');
      if (!supabase) {
        const data = readData();
        const customer = (data.gw_customers || []).find(c => String(c.phone || '').replace(/\D/g, '') === String(phone).replace(/\D/g, '')) || null;
        sendJSON(res, customer ? 200 : 404, { key, value: customer });
        return;
      }

      const { data: list, error } = await supabase.from('customers').select('*').eq('phone', phone);
      if (error || !list || !list.length) {
        sendJSON(res, 404, { ok: false, error: 'Customer not found' });
        return;
      }
      const c = list[0];
      const customers = await readCustomersFromSupabase();
      const found = customers.find(x => String(x.phone || '').replace(/\D/g, '') === String(phone).replace(/\D/g, '')) || null;
      sendJSON(res, found ? 200 : 404, { key, value: found });
      return;
    }

    sendJSON(res, 404, { ok: false, error: 'Unknown data key' });
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const value = payload.value;

        if (key === 'gw_staff') {
          await saveStaffToSupabase(value);
          const staff = await readStaffFromSupabase();
          sendJSON(res, 200, { ok: true, key, value: staff });
          return;
        }

        if (key === 'gw_customers') {
          await saveCustomersToSupabase(value);
          const customers = await readCustomersFromSupabase();
          sendJSON(res, 200, { ok: true, key, value: customers });
          return;
        }

        if (key.startsWith('customer:')) {
          const customer = payload.value || null;
          if (!customer) {
            sendJSON(res, 400, { ok: false, error: 'Missing customer object' });
            return;
          }
          await saveCustomersToSupabase([customer]);
          sendJSON(res, 200, { ok: true, key, value: customer });
          return;
        }

        sendJSON(res, 400, { ok: false, error: 'Unknown key' });
      } catch (e) {
        sendJSON(res, 400, { ok: false, error: e.message || 'Invalid JSON payload' });
      }
    });
    return;
  }

  sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/auth') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        await handleAuth(req, res, body);
      });
      return;
    }
    sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/api/send-otp') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        await handleSendOtp(req, res, body);
      });
      return;
    }
    sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/api/verify-otp') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        await handleVerifyOtp(req, res, body);
      });
      return;
    }
    sendJSON(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/api/data') {
    await handleData(req, res, url);
    return;
  }

  // Temporary diagnostic endpoint to reveal the server's working directory
  if (url.pathname === '/_whoami') {
    sendJSON(res, 200, {
      ok: true,
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv
    });
    return;
  }

  sendStatic(res, url.pathname);
});

server.listen(PORT, async () => {
  if (supabase) {
    await migrateLegacyDataToSupabase();
  }
  console.log(`Goodwill Tailor server listening on http://localhost:${PORT}`);
});
