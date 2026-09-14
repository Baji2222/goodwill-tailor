(async ()=>{
  try {
    const staffRes = await fetch('http://localhost:8001/api/data?key=gw_staff');
    const staffJson = await staffRes.json();
    const staff = staffJson.value || [];

    const tries = [
      ['admin','goodwill123'],
      ['master','master'],
      ['9494259885','9494259885']
    ];

    for (const [u,p] of tries) {
      const matched = staff.find(s => String(s.username||'')===u || String(s.phone||'')===u || String(s.id||'')===u);
      console.log('Try', u, p, '->', matched ? (String(matched.password||'')===String(p) ? 'OK' : 'INVALID_PASSWORD') : 'NO_USER');
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
