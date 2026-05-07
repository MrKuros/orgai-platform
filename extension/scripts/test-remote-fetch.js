const https = require('https');

const url = process.env.TEST_POLICY_URL;

if (!url) {
  console.error('ERROR: TEST_POLICY_URL not set');
  process.exit(1);
}

try {
  https.get(url, (res) => {
    if (res.statusCode !== 200) {
      console.error(`FAIL: returned status ${res.statusCode}`);
      process.exit(1);
    }

  let body = '';
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    let config;
    try {
      config = JSON.parse(body);
    } catch (e) {
      console.error('FAIL: invalid JSON');
      process.exit(1);
    }

    if (!config.hierarchy || !Array.isArray(config.hierarchy)) {
      console.error('FAIL: missing hierarchy key');
      process.exit(1);
    }

    if (typeof config.currentUserRole !== 'string') {
      console.error('FAIL: missing currentUserRole');
      process.exit(1);
    }

    for (const entry of config.hierarchy) {
      if (!entry.role || !entry.displayName || !Array.isArray(entry.policies)) {
        console.error(`FAIL: missing fields in role entry "${entry.role || 'unknown'}"`);
        process.exit(1);
      }
      for (const policy of entry.policies) {
        if (typeof policy !== 'string' || policy.trim().length === 0) {
          console.error(`FAIL: invalid policy entry in role ${entry.role}`);
          process.exit(1);
        }
      }
    }

    console.log(`PASS: policies loaded successfully — ${config.hierarchy.length} roles found`);
    process.exit(0);
  });
  }).on('error', (e) => {
    console.error(`FAIL: network error — ${e.message}`);
    process.exit(1);
  });
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exit(1);
}
