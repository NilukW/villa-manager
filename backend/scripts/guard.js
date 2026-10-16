// Refuses to run dev-only scripts on the production server.
// deploy.sh writes NODE_ENV=production into backend/.env on the server; local .env files don't have it.
const fs = require('fs');
const path = require('path');

module.exports = function refuseInProduction(scriptName) {
    let env = process.env.NODE_ENV || '';
    try {
        const file = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        const match = file.match(/^NODE_ENV\s*=\s*(\S+)/m);
        if (match) env = match[1];
    } catch (e) { /* no .env: treat as development */ }

    if (env === 'production') {
        console.error(`${scriptName} is for local testing only and will not run on a production server (NODE_ENV=production).`);
        process.exit(1);
    }
};
