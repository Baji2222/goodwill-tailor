const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function ensureSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
}

async function getStaffRows(supabase) {
  const { data, error } = await supabase.from('staff').select('*');
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    username: row.username,
    name: row.name,
    isAdmin: Boolean(row.is_admin),
    password: ''
  }));
}

async function getCustomersRows(supabase) {
  const { data: customers, error: cErr } = await supabase.from('customers').select('*');
  if (cErr) throw cErr;

  const { data: orders, error: oErr } = await supabase.from('orders').select('*');
  if (oErr) throw oErr;

  const { data: photos, error: pErr } = await supabase.from('order_photos').select('*');
  if (pErr) throw pErr;

  const photoMap = new Map();
  for (const photo of photos || []) photoMap.set(photo.order_id, photoMap.get(photo.order_id) || []);
  for (const photo of photos || []) {
    const arr = photoMap.get(photo.order_id) || [];
    arr.push(photo.public_url || photo.storage_path);
    photoMap.set(photo.order_id, arr);
  }

  const ordersByCustomer = new Map();
  for (const order of orders || []) {
    const l = ordersByCustomer.get(order.customer_id) || [];
    l.push({
      id: order.id,
      type: order.order_type,
      status: order.status,
      dueDate: order.due_date,
      total: Number(order.total || 0),
      paid: Number(order.paid || 0),
      advancePaid: Number(order.paid || 0),
      measurements: order.measurements,
      notes: order.notes,
      quantity: Number(order.quantity || 0),
      garments: typeof order.garments === 'object' ? order.garments : {},
      takenBy: order.taken_by || 'Staff',
      createdAt: order.created_at,
      photos: photoMap.get(order.id) || []
    });
    ordersByCustomer.set(order.customer_id, l);
  }

  return (customers || []).map(c => ({
    id: c.id,
    phone: c.phone,
    name: c.name,
    address: c.address || '',
    notes: c.notes || '',
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    orders: ordersByCustomer.get(c.id) || []
  }));
}

async function saveStaffRows(supabase, value) {
  for (const row of Array.isArray(value) ? value : []) {
    const id = row.id || crypto.randomUUID();
    await supabase.from('staff').upsert({
      id,
      username: row.username,
      password_hash: hashPassword(row.password || ''),
      name: row.name || row.username,
      is_admin: Boolean(row.isAdmin)
    }, { onConflict: 'id' });
  }
}

async function saveCustomersRows(supabase, value) {
  const list = Array.isArray(value) ? value : [];

  for (const customer of list) {
    const customerId = customer.id || `customer-${crypto.randomUUID()}`;
    await supabase.from('customers').upsert({
      id: customerId,
      phone: normalizePhone(customer.phone),
      name: customer.name,
      address: customer.address || '',
      notes: customer.notes || '',
      created_at: customer.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    for (const order of customer.orders || []) {
      const orderId = order.id || `ORD-${Math.round(Date.now() % 1000000)}`;
      await supabase.from('orders').upsert({
        id: orderId,
        customer_id: customerId,
        order_type: order.type || 'tailoring',
        status: order.status || 'pending',
        due_date: order.dueDate || '',
        total: Number(order.total || 0),
        paid: Number(order.advancePaid || order.paid || 0),
        measurements: order.measurements || '',
        notes: order.notes || '',
        quantity: Number(order.quantity || 0),
        garments: order.garments || { shirt: 0, pant: 0 },
        taken_by: order.takenBy || 'Staff',
        created_at: order.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      for (const photo of order.photos || []) {
        if (!String(photo).startsWith('data:')) continue;

        const match = String(photo).match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,(.*)$/);
        if (!match) continue;

        const ext = match[1] === 'jpg' ? 'jpg' : match[1] === 'jpeg' ? 'jpeg' : match[1] === 'gif' ? 'gif' : 'webp';
        const filename = `${orderId}-${crypto.randomUUID()}.${ext}`;
        const base64 = match[2];
        const buffer = Buffer.from(base64, 'base64');

        const { error: uploadError } = await supabase.storage.from('order-photos').upload(filename, buffer, {
          contentType: `image/${ext}`,
          upsert: true
        });

        if (!uploadError) {
          const { data: publicUrlData } = await supabase.storage.from('order-photos').getPublicUrl(filename);
          const photoId = `photo-${crypto.randomUUID()}`;
          await supabase.from('order_photos').upsert({
            id: photoId,
            order_id: orderId,
            storage_path: filename,
            public_url: publicUrlData?.publicUrl || ''
          }, { onConflict: 'id' });
        }
      }
    }
  }
}

async function handleGet(req, res, key) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    sendJson(res, 500, { ok: false, error: 'Missing Supabase environment variables' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

  if (key === 'gw_staff') {
    const value = await getStaffRows(supabase);
    sendJson(res, 200, { key, value });
    return;
  }

  if (key === 'gw_customers') {
    const value = await getCustomersRows(supabase);
    sendJson(res, 200, { key, value });
    return;
  }

  if (key.startsWith('customer:')) {
    const phone = normalizePhone(key.replace(/^customer:/, ''));
    const list = await getCustomersRows(supabase);
    const match = list.find(c => normalizePhone(c.phone) === phone) || null;
    if (!match) {
      sendJson(res, 404, { key, value: null });
      return;
    }
    sendJson(res, 200, { key, value: match });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Unknown data key' });
}

async function handlePost(req, res, key) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    sendJson(res, 500, { ok: false, error: 'Missing Supabase environment variables' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
  const payload = await readBody(req);
  const value = payload.value;

  if (key === 'gw_staff') {
    await saveStaffRows(supabase, value);
    const staff = await getStaffRows(supabase);
    sendJson(res, 200, { ok: true, key, value: staff });
    return;
  }

  if (key === 'gw_customers') {
    await saveCustomersRows(supabase, value);
    const customers = await getCustomersRows(supabase);
    sendJson(res, 200, { ok: true, key, value: customers });
    return;
  }

  if (key.startsWith('customer:')) {
    await saveCustomersRows(supabase, Array.isArray(value) ? value : [value]);
    sendJson(res, 200, { ok: true, key, value });
    return;
  }

  sendJson(res, 400, { ok: false, error: 'Unknown key' });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url || '/', 'https://example.com');
  const key = url.searchParams.get('key') || '';

  if (!key) {
    sendJson(res, 400, { ok: false, error: 'Missing key' });
    return;
  }

  if (req.method === 'GET') {
    await handleGet(req, res, key);
    return;
  }

  if (req.method === 'POST') {
    await handlePost(req, res, key);
    return;
  }

  sendJson(res, 405, { ok: false, error: 'Method not allowed' });
};
