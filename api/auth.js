const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw || '')).digest('hex');
}

// Keep the documented demo administrator available on first serverless use.
// A previous client could accidentally replace its hash with the empty-password
// hash, so repair only that known bad state without overriding a custom password.
async function ensureDefaultAdmin(supabase) {
  const { data: rows, error } = await supabase
    .from('staff')
    .select('id, password_hash')
    .eq('username', 'admin');

  if (error) throw error;

  if (!rows || !rows.length) {
    const { error: insertError } = await supabase.from('staff').insert({
      id: 'admin1',
      username: 'admin',
      password_hash: hashPassword('goodwill123'),
      name: 'Admin',
      is_admin: true
    });
    if (insertError) throw insertError;
    return;
  }

  if (rows[0].password_hash === hashPassword('')) {
    const { error: updateError } = await supabase
      .from('staff')
      .update({ password_hash: hashPassword('goodwill123') })
      .eq('id', rows[0].id);
    if (updateError) throw updateError;
  }
}

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

module.exports = async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    sendJson(res, 500, { ok: false, error: 'Missing Supabase environment variables' });
    return;
  }

  try {
    const payload = await readBody(req);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');

    if (!username || !password) {
      sendJson(res, 400, { ok: false, error: 'Missing username or password' });
      return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    await ensureDefaultAdmin(supabase);

    const { data: staffRows, error } = await supabase.from('staff').select('*').eq('username', username);

    if (error || !staffRows || !staffRows.length) {
      sendJson(res, 401, { ok: false, error: 'Invalid credentials' });
      return;
    }

    const user = staffRows[0];
    const hash = hashPassword(password);

    if (user.password_hash !== hash) {
      sendJson(res, 401, { ok: false, error: 'Invalid credentials' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      user: { id: user.id, name: user.name, username: user.username, isAdmin: Boolean(user.is_admin) }
    });
  } catch (e) {
    sendJson(res, 400, { ok: false, error: 'Invalid auth payload' });
  }
};
