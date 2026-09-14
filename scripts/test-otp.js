(async ()=>{
  try {
    const phone = process.argv[2] || '9998887776';

    const send = await fetch('http://localhost:8001/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });

    const sendJson = await send.json().catch(() => null);
    console.log('send-otp response:', JSON.stringify(sendJson));

    const otp = (sendJson && (sendJson.devOtp || sendJson.devOtp)) || null;
    if (!otp) {
      console.error('No devOtp returned; cannot verify OTP automatically.');
      process.exit(0);
    }

    const verify = await fetch('http://localhost:8001/api/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp })
    });

    const verifyJson = await verify.json().catch(() => null);
    console.log('verify-otp response:', JSON.stringify(verifyJson));
  } catch (e) {
    console.error('error', e);
    process.exit(1);
  }
})();
