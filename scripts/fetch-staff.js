(async ()=>{
  try {
    const res = await fetch('http://localhost:8001/api/data?key=gw_staff');
    const j = await res.json();
    console.log(JSON.stringify(j, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
